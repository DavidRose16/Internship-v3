const Anthropic = require('@anthropic-ai/sdk');

const anthropic = new Anthropic();

/**
 * Generate a personalized cold email for internship outreach.
 * Enforces the 120-word limit — retries once if the first draft is too long.
 *
 * @param {{name, website, category}} company
 * @param {{description, whyFit, specificObservation}} research
 * @param {{name, position, email}} contact
 * @param {string} background - contents of background.md
 * @param {string} voice - contents of voice.md
 * @returns {Promise<string>} the email body text
 */
async function generateEmail(company, research, contact, background, voice) {
  const emailBody = await draft(company, research, contact, background, voice);
  const wordCount = emailBody.split(/\s+/).length;

  if (wordCount > 130) {
    const trimmed = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 512,
      messages: [{
        role: 'user',
        content: `This email is ${wordCount} words. Rewrite it to be under 120 words while keeping the specific details and natural tone. Do not make it generic.\n\n${emailBody}\n\nRespond with ONLY the rewritten email. No quotes, no labels.`
      }]
    });
    return trimmed.content[0].text.trim();
  }

  return emailBody;
}

async function draft(company, research, contact, background, voice) {
  const message = await anthropic.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 512,
    messages: [{
      role: 'user',
      content: `Write a cold email for internship outreach.

RECIPIENT:
- Name: ${contact.name}
- Role: ${contact.position}
- Company: ${company.name}

COMPANY RESEARCH:
- What they do: ${research.description}
- Why I'm a fit: ${research.whyFit}
- Specific observation to weave in: ${research.specificObservation}

MY BACKGROUND:
${background}

VOICE & STYLE GUIDE:
${voice}

RULES:
- MUST be under 120 words — count carefully
- Weave in the specific observation naturally, don't force it
- No generic praise ("I love your mission", "your company is amazing")
- Be direct about wanting an internship or opportunity to contribute
- Sound like a real person, not a mail-merge template
- Include a clear but low-pressure ask at the end
- Do NOT include a subject line — just the email body
- Do NOT include [brackets] or placeholders — write the final text
- Address the recipient by first name

Respond with ONLY the email text. No quotes, no labels, no explanation.`
    }]
  });

  return message.content[0].text.trim();
}

/**
 * Generate a short, specific subject line for the email.
 */
async function generateSubject(company, research) {
  const message = await anthropic.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 64,
    messages: [{
      role: 'user',
      content: `Write a short email subject line for a cold internship outreach email to ${company.name}.

They do: ${research.description}

Rules:
- Under 8 words
- No generic lines like "Internship Opportunity" or "Excited to Connect"
- Reference something specific about the company
- Lowercase is fine

Respond with ONLY the subject line. No quotes.`
    }]
  });

  return message.content[0].text.trim();
}

module.exports = { generateEmail, generateSubject };
