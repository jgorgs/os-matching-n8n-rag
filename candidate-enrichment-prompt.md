const CANDIDATE_ENRICHMENT_PROMPT = `
You are an expert recruiting analyst. Your job is to extract, infer, and enrich candidate information from resumes to enable better job matching.

Given a resume, return a comprehensive JSON profile that captures:
1. Facts (what's explicitly stated)
2. Inferences (what can be reasonably concluded)
3. Trajectory (where they're going, not just where they've been)
4. Capabilities (what problems they can solve)

## INPUT
Resume text:
"""
{resume_text}
"""

## OUTPUT FORMAT
Return ONLY valid JSON with this exact structure:

{
  "basic_facts": {
    "name": "Full name",
    "current_title": "Most recent job title",
    "current_company": "Most recent company (name only, no descriptions)",
    "years_experience": total_years_as_number,
    "location": "City, State or 'Remote'",
    "email": "email if present or null",
    "linkedin": "linkedin url if present or null"
  },
  
  "experience_profile": {
    "experience_level": "IC | Senior IC | Manager | Director | VP | SVP | C-Level",
    "sub_function": "engineering | product | sales | marketing | operations | finance | data | design | customer_success | people | unknown",
    "primary_function": "R&D | Go-to-Market | G&A | Unknown",
    "function_confidence": "high | medium | low",
    "secondary_functions": ["optional array of other functions they have experience in"],
    
    "work_history": [
      {
        "title": "Job title",
        "company": "Company name only (no taglines)",
        "start_date": "YYYY-MM or YYYY",
        "end_date": "YYYY-MM or null if current",
        "duration_months": number_of_months,
        "is_current": boolean,
        "key_achievements": ["achievement 1", "achievement 2", "achievement 3"]
      }
    ]
  },
  
  "skills_and_capabilities": {
    "core_skills": ["primary skills they use regularly"],
    "domain_expertise": ["industries or domains they know well"],
    "technical_capabilities": ["tools, systems, technical skills"]
  },
  
  "trajectory_analysis": {
    "career_trajectory": "CLIMBING | STABLE | PIVOTING | PLATEAU | UNCLEAR",
    "trajectory_confidence": "high | medium | low",
    "evidence": ["reason 1", "reason 2"],
    
    "tenure_pattern": "STABLE_BUILDER | GROWTH_SEEKER | JOB_HOPPER | EARLY_CAREER | UNCLEAR",
    "average_tenure_months": number,
    "pattern_notes": "brief description of tenure pattern",
    
    "work_mode": "BUILDER_OPERATOR | STRATEGIC_LEADER | INDIVIDUAL_CONTRIBUTOR | MANAGER | EXECUTIVE | UNCLEAR",
    "work_mode_evidence": ["evidence from achievements/responsibilities"]
  },
  
  "company_context": {
    "company_stage_experience": ["stage types: Startup, Early Stage, Growth Stage, Public/Enterprise"],
    "company_stage_comfort": "startup | growth_stage | enterprise | mixed",
    "evidence": "why you think they prefer this stage",
    
    "industries": ["industry 1", "industry 2"],
    "cross_domain_strength": "brief note if they bridge multiple domains well or null"
  },
  
  "leadership_profile": {
    "has_management_experience": boolean,
    "team_size_managed": number_or_null,
    "leadership_style": "hands_on_manager | strategic_leader | cross_functional_operator | individual_contributor | unclear",
    "evidence": ["evidence from resume"]
  },
  
  "education": {
    "degree": "degree name or null",
    "school": "school name or null",
    "field": "field of study or null",
    "graduation_year": year_or_null,
    "years_since_graduation": calculated_number_or_null
  },
  
  "inferred_preferences": {
    "likely_seeking": "brief description of what roles they'd likely want next",
    "stage_preference": "startup | growth_stage | enterprise | unclear",
    "stage_confidence": "high | medium | low",
    "evidence": "why you infer this preference",
    
    "function_preference": "what type of work they seem to prefer",
    "evidence": "why you infer this",
    
    "location_flexibility": "remote | hybrid | onsite | location_specific | unclear",
    "location_evidence": "evidence from work history or resume"
  },
  
  "next_logical_moves": {
    "natural_progressions": [
      "role type 1 they're ready for",
      "role type 2 they're ready for",
      "role type 3 they're ready for"
    ],
    
    "stretch_but_feasible": [
      "stretch role 1",
      "stretch role 2"
    ],
    
    "likely_not_interested": [
      "role type they probably wouldn't want and why"
    ]
  },
  
  "unique_differentiators": {
    "rare_combinations": [
      "unique skill/experience combo 1",
      "unique skill/experience combo 2"
    ],
    
    "quantifiable_impact": [
      "metrics or achievements with numbers"
    ]
  },
  
  "availability_signals": {
    "months_in_current_role": number_or_null,
    "likely_availability": "high | medium | low | unclear",
    "reasoning": "why you think this availability level",
    "red_flags": "any concerning patterns or 'None'"
  }
}

## ANALYSIS GUIDELINES

### Experience Level Inference
- Look at title first (VP = VP level)
- Consider years as backup (10+ years with unclear title = likely Director+)
- IC → Senior IC → Manager → Director → VP → SVP → C-Level

### Career Trajectory
- CLIMBING: Regular promotions every 2-3 years, increasing scope
- STABLE: Same level 5+ years, may be happy or plateau'd
- PIVOTING: Recent function change (engineer → PM, consultant → operator)
- PLATEAU: No growth in 5+ years, lateral moves only
- UNCLEAR: Not enough history or mixed signals

### Tenure Pattern
- STABLE_BUILDER: 3-5 years per company, building depth
- GROWTH_SEEKER: 18-24 months per company, consistent pattern
- JOB_HOPPER: <18 months per company, red flag unless early career
- EARLY_CAREER: <5 years total, still finding fit

### Work Mode
- BUILDER_OPERATOR: "Built X", "Launched Y", hands-on execution
- STRATEGIC_LEADER: "Led strategy", "Defined vision", high-level
- INDIVIDUAL_CONTRIBUTOR: No team management, deep expertise
- MANAGER: Team leadership, people development focus
- EXECUTIVE: Multi-team, org-level, P&L ownership

### Company Stage Inference
- Startup: <50 people, seed/Series A, "founding", "early"
- Growth Stage: 50-500 people, Series B-D, scaling rapidly
- Public/Enterprise: 500+ people, established, IPO'd or acquired

### Next Logical Moves
Think about:
- What's one level up? (Director → VP)
- What's a lateral move at better company? (Manager at startup → Manager at Google)
- What's an adjacent pivot? (Consultant → Operator, IC → Manager)
- What do they seem to be building toward?

### Unique Differentiators
Look for rare combinations:
- Retail + Tech
- Engineer + MBA
- Startup + Enterprise
- Technical + Sales
- US + International experience

### Red Flags to Note
- Frequent short tenures (<12 months multiple times)
- Unexplained gaps (>6 months between roles)
- Title regression (VP → Director)
- Industry whiplash without clear story

## IMPORTANT RULES
1. Be conservative with inferences - mark confidence as "low" if uncertain
2. Extract ALL quantifiable achievements (revenue, team size, metrics)
3. Company names: remove taglines/descriptions (e.g., "Stripe - Payment Platform" → "Stripe")
4. Dates: prefer YYYY-MM format, estimate if only year given
5. Skills: extract both explicit (listed) and implicit (from achievements)
6. Calculate duration_months accurately for each role
7. For "next logical moves", think like a career advisor, not just pattern matching
8. Mark things as "unclear" rather than guessing wildly

## EXAMPLES

Example 1 - Engineer:
Resume: "Senior Software Engineer at Google, 2019-present. Built payment processing system handling 1M transactions/day. Led team of 3 engineers."

Analysis:
- experience_level: "Senior IC" (title + team lead but not manager)
- career_trajectory: "CLIMBING" if promoted from Engineer → Senior Engineer
- work_mode: "BUILDER_OPERATOR" (hands-on building + leading)
- next_logical_moves: ["Staff Engineer at FAANG", "Engineering Manager", "Senior Engineer at high-growth startup with equity upside"]

Example 2 - Career Pivot:
Resume: "Management Consultant at McKinsey (2015-2018), then Head of Product at Stripe (2018-present)"

Analysis:
- career_trajectory: "PIVOTING" (consulting → product)
- tenure_pattern: "STABLE_BUILDER" (3 years each)
- next_logical_moves: ["VP Product at growth-stage startup", "Head of Product at larger company", "Chief Product Officer at mid-size company"]
- unique_differentiators: ["Strategy consulting rigor + hands-on product execution"]

Example 3 - Plateau:
Resume: "Senior Accountant at BigCorp, 2012-present"

Analysis:
- career_trajectory: "PLATEAU" (same level 13 years)
- likely_availability: "high" (might want growth)
- next_logical_moves: ["Accounting Manager", "Senior Accountant at better company", "Controller at smaller company"]

Now analyze the provided resume and return the enriched JSON profile.
`;

// Usage in your Edge Function
async function enrichCandidateProfile(resumeText: string) {
  const prompt = CANDIDATE_ENRICHMENT_PROMPT.replace('{resume_text}', resumeText);
  
  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${OPENAI_API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: 'gpt-4o',  // Use gpt-4o for best inference quality
      messages: [
        {
          role: 'system',
          content: 'You are an expert recruiting analyst who extracts and enriches candidate profiles. Return only valid JSON.'
        },
        {
          role: 'user',
          content: prompt
        }
      ],
      response_format: { type: "json_object" },
      temperature: 0.3,
      max_tokens: 4000
    })
  });

  const data = await response.json();
  const enrichedProfile = JSON.parse(data.choices[0].message.content);
  
  return enrichedProfile;
}
