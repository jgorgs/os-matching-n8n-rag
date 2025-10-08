import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const OPENAI_API_KEY = Deno.env.get('OPENAI_API_KEY')!

serve(async (req) => {
  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  )

  const { candidate_id } = await req.json()
  
  console.log(`Processing candidate: ${candidate_id}`)

  try {
    // Mark as processing
    await supabase
      .from('candidates')
      .update({ 
        enrichment_status: 'processing',
        enrichment_attempted_at: new Date().toISOString()
      })
      .eq('id', candidate_id)

    // Get candidate data
    const { data: candidate, error: fetchError } = await supabase
      .from('candidates')
      .select('*')
      .eq('id', candidate_id)
      .single()

    if (fetchError) throw fetchError

    let parsedData: any = {
      current_title: candidate.current_title || 'Unknown',
      current_company: candidate.current_company || 'Unknown',
      years_experience: 0,
      average_tenure_months: 0,
      work_history: [],
      skills: [],
      top_skills: [],
      industries: []
    }

    // Step 1: Parse resume if provided
    if (candidate.resume_url) {
      console.log('Parsing resume...')
      try {
        parsedData = await parseResume(candidate.resume_url)
        
        // Update with resume text immediately
        await supabase
          .from('candidates')
          .update({ 
            resume_text: parsedData.full_text,
            resume_parsed_at: new Date().toISOString()
          })
          .eq('id', candidate_id)
      } catch (resumeError: any) {
        console.error('Resume parsing failed:', resumeError)
        await supabase
          .from('candidates')
          .update({ 
            resume_parsing_error: resumeError.message
          })
          .eq('id', candidate_id)
        // Continue with LinkedIn-only enrichment
      }
    }

    // Step 2: Derive function from parsed data
    const derivedFunction = deriveFunction(parsedData, candidate)

    // Step 3: Calculate quality metrics
    const qualityMetrics = calculateQualityMetrics(parsedData, candidate)

    // Step 4: Apply quality gates
    const qualityGate = applyQualityGate(qualityMetrics, parsedData)

    // Step 5: Update candidate with all enriched data
    const updateData = {
      current_title: parsedData.current_title,
      current_company: parsedData.current_company,
      years_experience: parsedData.years_experience,
      average_tenure_months: parsedData.average_tenure_months,
      work_history: JSON.stringify(parsedData.work_history),
      skills: parsedData.skills,
      top_skills: parsedData.top_skills,
      industries: parsedData.industries,
      education: parsedData.education ? JSON.stringify(parsedData.education) : null,
      ...derivedFunction,
      ...qualityMetrics,
      status: qualityGate.status,
      auto_approved: qualityGate.auto_approved,
      rejection_reason: qualityGate.rejection_reason,
      approved_at: qualityGate.auto_approved ? new Date().toISOString() : null,
      enrichment_status: 'completed',
      requires_enrichment: false
    }

    await supabase
      .from('candidates')
      .update(updateData)
      .eq('id', candidate_id)

    // Step 6: If approved, trigger embedding generation
    if (qualityGate.auto_approved) {
      await supabase.functions.invoke('generate-embedding', {
        body: { candidate_id }
      })
    }

    return new Response(
      JSON.stringify({ 
        success: true, 
        candidate_id,
        status: qualityGate.status,
        auto_approved: qualityGate.auto_approved
      }),
      { headers: { 'Content-Type': 'application/json' } }
    )

  } catch (error: any) {
    console.error('Error processing candidate:', error)
    
    // Mark as failed
    await supabase
      .from('candidates')
      .update({ 
        enrichment_status: 'failed',
        enrichment_error: error.message
      })
      .eq('id', candidate_id)

    return new Response(
      JSON.stringify({ success: false, error: error.message }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    )
  }
})

// Parse resume using GPT-4o-mini
async function parseResume(resumeUrl: string) {
  console.log('Fetching resume from:', resumeUrl)
  
  // Fetch the resume file
  const response = await fetch(resumeUrl)
  if (!response.ok) {
    throw new Error(`Failed to fetch resume: ${response.statusText}`)
  }
  
  const contentType = response.headers.get('content-type') || ''
  console.log('Content type:', contentType)
  
  // For PDFs and Word docs, we'll extract text differently
  const buffer = await response.arrayBuffer()
  const text = new TextDecoder().decode(buffer) // Simple text extraction for now
  
  // Use GPT-4o-mini to extract structured data from text
  const gptResponse = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${OPENAI_API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      messages: [{
        role: 'user',
        content: `Extract structured information from this resume text. Return ONLY valid JSON with this exact structure (no markdown, no explanation):

{
  "full_text": "Complete text from resume",
  "current_title": "Current or most recent job title",
  "current_company": "Current or most recent company",
  "years_experience": total_years_as_number,
  "work_history": [
    {
      "title": "Job title",
      "company": "Company name",
      "start_date": "YYYY-MM",
      "end_date": "YYYY-MM or null if current",
      "duration_months": number_of_months,
      "key_achievements": ["achievement 1", "achievement 2"]
    }
  ],
  "skills": ["skill1", "skill2", "skill3"],
  "education": {
    "degree": "Degree name",
    "school": "School name",
    "field": "Field of study",
    "graduation_year": year_as_number
  },
  "industries": ["industry1", "industry2"]
}

Resume text:
${text.substring(0, 4000)}

Remember: Return ONLY the JSON object, nothing else.`
      }],
      temperature: 0.3,
      max_tokens: 2000
    })
  })

  const gptData = await gptResponse.json()
  
  if (!gptData.choices || !gptData.choices[0]) {
    throw new Error('Invalid response from GPT')
  }
  
  let content = gptData.choices[0].message.content
  
  // Strip markdown code blocks if present
  content = content.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim()
  
  const parsed = JSON.parse(content)
  
  // Calculate average tenure
  const totalMonths = parsed.work_history.reduce((sum: number, job: any) => 
    sum + (job.duration_months || 0), 0
  )
  parsed.average_tenure_months = parsed.work_history.length > 0
    ? Math.round((totalMonths / parsed.work_history.length) * 10) / 10
    : 0

  parsed.top_skills = parsed.skills.slice(0, 8)
  
  return parsed
}

// Derive function from title and work history
function deriveFunction(parsedData: any, candidate: any) {
  const currentTitle = (parsedData.current_title || candidate.current_title || '').toLowerCase()
  const workHistory = parsedData.work_history || []

  const functionPatterns = {
    engineering: ['engineer', 'developer', 'swe', 'software', 'backend', 'frontend', 'full stack', 'devops', 'sre', 'architect', 'tech lead', 'staff', 'principal'],
    product: ['product manager', 'pm ', ' pm', 'product lead', 'product owner', 'head of product', 'vp product', 'director of product'],
    sales: ['sales', 'account executive', 'ae ', ' ae', 'business development', 'bd ', ' bd', 'vp sales', 'director of sales', 'revenue'],
    marketing: ['marketing', 'growth', 'demand gen', 'cmo', 'vp marketing', 'director of marketing', 'brand'],
    finance: ['finance', 'cfo', 'controller', 'fp&a', 'financial analyst', 'director of finance'],
    people: ['hr', 'people', 'human resources', 'chro', 'talent', 'recruiting', 'head of people'],
    data: ['data scientist', 'data analyst', 'analytics', 'ml engineer', 'data engineer'],
    design: ['designer', 'ux', 'ui', 'product design', 'design lead']
  }

  const primaryMap: Record<string, string> = {
    engineering: 'r_and_d',
    product: 'r_and_d',
    design: 'r_and_d',
    data: 'r_and_d',
    sales: 'go_to_market',
    marketing: 'go_to_market',
    finance: 'g_and_a',
    people: 'g_and_a'
  }

  // Check current title
  for (const [func, patterns] of Object.entries(functionPatterns)) {
    if (patterns.some(p => currentTitle.includes(p))) {
      return {
        sub_function: func,
        primary_function: primaryMap[func] || 'unknown',
        function_confidence: 'high',
        function_derivation_source: 'resume_title'
      }
    }
  }

  // Check work history
  const functionCounts: Record<string, number> = {}
  for (const job of workHistory) {
    const title = (job.title || '').toLowerCase()
    for (const [func, patterns] of Object.entries(functionPatterns)) {
      if (patterns.some(p => title.includes(p))) {
        functionCounts[func] = (functionCounts[func] || 0) + 1
      }
    }
  }

  const entries = Object.entries(functionCounts)
  if (entries.length > 0) {
    const [func, count] = entries.sort((a, b) => b[1] - a[1])[0]
    return {
      sub_function: func,
      primary_function: primaryMap[func] || 'unknown',
      function_confidence: count >= 2 ? 'high' : 'medium',
      function_derivation_source: 'work_history'
    }
  }

  return {
    sub_function: 'unknown',
    primary_function: 'unknown',
    function_confidence: 'low',
    function_derivation_source: 'unclear'
  }
}

// Calculate quality metrics
function calculateQualityMetrics(parsedData: any, candidate: any) {
  const years = parsedData.years_experience || 0
  const tenure = parsedData.average_tenure_months || 0
  const workHistory = parsedData.work_history || []

  let experienceLevel = 'mid'
  if (years >= 12) experienceLevel = 'director'
  else if (years >= 10) experienceLevel = 'principal'
  else if (years >= 7) experienceLevel = 'staff'
  else if (years >= 5) experienceLevel = 'senior'

  let qualityScore = 0
  qualityScore += Math.min(40, Math.max(0, ((years - 3) / 12) * 40))
  
  if (tenure >= 24 && tenure <= 48) qualityScore += 20
  else if (tenure >= 18) qualityScore += 15
  else qualityScore += 5

  const topTierCompanies = ['google', 'meta', 'facebook', 'amazon', 'apple', 'microsoft', 'stripe', 'airbnb', 'netflix', 'uber']
  const hasTopTier = workHistory.some((job: any) => 
    topTierCompanies.some(co => (job.company || '').toLowerCase().includes(co))
  )
  qualityScore += hasTopTier ? 25 : 12

  const hasLeadership = workHistory.some((job: any) => {
    const title = (job.title || '').toLowerCase()
    return ['lead', 'principal', 'staff', 'director', 'vp', 'head of', 'manager', 'senior'].some(kw => title.includes(kw))
  })
  qualityScore += hasLeadership ? 15 : 8

  return {
    experience_level: experienceLevel,
    experience_quality_score: Math.round(qualityScore)
  }
}

// Apply quality gate
function applyQualityGate(metrics: any, parsedData: any) {
  const years = parsedData.years_experience || 0
  const tenure = parsedData.average_tenure_months || 0
  const qualityScore = metrics.experience_quality_score

  const meetsMinExp = years >= 3
  const meetsMinTenure = tenure >= 18
  const hasGoodQuality = qualityScore >= 50

  const shouldAutoApprove = meetsMinExp && meetsMinTenure && hasGoodQuality

  let rejectionReason = null
  if (!meetsMinExp) rejectionReason = 'Below 3 years experience'
  else if (!meetsMinTenure) rejectionReason = 'Average tenure below 18 months'
  else if (!hasGoodQuality) rejectionReason = 'Quality score below threshold - needs review'

  return {
    status: shouldAutoApprove ? 'approved' : 'pending',
    auto_approved: shouldAutoApprove,
    rejection_reason: rejectionReason
  }
}