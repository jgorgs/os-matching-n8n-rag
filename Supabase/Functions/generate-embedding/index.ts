import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const OPENAI_API_KEY = Deno.env.get('OPENAI_API_KEY')!

serve(async (req) => {
  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  )

  const { candidate_id } = await req.json()

  try {
    console.log(`Generating embedding for candidate: ${candidate_id}`)

    // Get candidate data
    const { data: candidate, error: fetchError } = await supabase
      .from('candidates')
      .select('*')
      .eq('id', candidate_id)
      .single()

    if (fetchError) throw fetchError

    // Create embedding document
    const embeddingDoc = createEmbeddingDocument(candidate)

    // Generate embedding
    const response = await fetch('https://api.openai.com/v1/embeddings', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${OPENAI_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'text-embedding-3-large',
        input: embeddingDoc
      })
    })

    const data = await response.json()
    
    if (!data.data || !data.data[0]) {
      throw new Error('Invalid embedding response from OpenAI')
    }
    
    const embedding = data.data[0].embedding

    // Update candidate with embedding
    await supabase
      .from('candidates')
      .update({
        embedding_doc: embeddingDoc,
        embedding: JSON.stringify(embedding),
        last_embedding_update: new Date().toISOString()
      })
      .eq('id', candidate_id)

    console.log(`Embedding generated successfully for candidate: ${candidate_id}`)

    // TODO: Trigger auto-match to jobs (build this next)
    // await supabase.functions.invoke('auto-match-candidate', {
    //   body: { candidate_id }
    // })

    return new Response(
      JSON.stringify({ success: true, candidate_id }),
      { headers: { 'Content-Type': 'application/json' } }
    )

  } catch (error: any) {
    console.error('Error generating embedding:', error)
    return new Response(
      JSON.stringify({ success: false, error: error.message }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    )
  }
})

function createEmbeddingDocument(candidate: any) {
  const workHistory = JSON.parse(candidate.work_history || '[]')
  const recentRoles = workHistory.slice(0, 3).map((job: any) => {
    const achievements = job.key_achievements?.slice(0, 2).join('; ') || ''
    return `- ${job.title} at ${job.company} (${job.duration_months}mo)${achievements ? ': ' + achievements : ''}`
  }).join('\n')

  const education = candidate.education ? JSON.parse(candidate.education) : null

  return `
[Name]: ${candidate.name}
[Current Role]: ${candidate.current_title} at ${candidate.current_company}
[Years of Experience]: ${candidate.years_experience} years
[Experience Level]: ${candidate.experience_level}
[Core Function]: ${candidate.sub_function}

[Professional Summary]:
${candidate.experience_level} professional with ${candidate.years_experience} years of experience in ${candidate.sub_function}.
Average tenure: ${candidate.average_tenure_months} months. Quality score: ${candidate.experience_quality_score}/100.

[Recent Experience]:
${recentRoles || 'No work history available'}

[Skills]: ${(candidate.top_skills || []).join(', ') || 'No skills listed'}

[Industries]: ${(candidate.industries || []).join(', ') || 'Not specified'}

[Education]: ${education ? `${education.degree} in ${education.field} from ${education.school} (${education.graduation_year})` : 'Not specified'}

[Location]: ${candidate.location || 'Not specified'}
`.trim()
}