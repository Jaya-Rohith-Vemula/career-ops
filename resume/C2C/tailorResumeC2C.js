import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { execFileSync } from 'child_process';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const outputDir = join(__dirname, 'output');
const templatePath = join(__dirname, 'base_resume_c2c.md');
const jdPath = join(__dirname, 'current-jd.txt');
const referenceDocxPath = join(__dirname, 'reference.docx');

// process.env isn't populated from .env by anything else in this codebase —
// load it directly so RESUME_DOCUMENT_NAME takes effect when set there.
try {
  process.loadEnvFile(join(__dirname, '..', '..', '.env'));
} catch {
  // .env is optional — real env vars (e.g. in production) take precedence anyway
}

const RESUME_DOCUMENT_NAME = 'Jaya Senior Developer';

// Each entry describes how to invoke that CLI non-interactively with a single
// prompt string and get the model's raw text response on stdout.
const AGENT_CLIS = {
  claude: { bin: 'claude', args: (prompt) => ['-p', prompt] },
  codex: { bin: 'codex', args: (prompt) => ['exec', prompt] },
};

const AGENT_CLI = process.env.AGENT_CLI || 'claude';
const agentCli = AGENT_CLIS[AGENT_CLI];
if (!agentCli) {
  console.error(
    `Unknown AGENT_CLI "${AGENT_CLI}". Supported: ${Object.keys(AGENT_CLIS).join(', ')}`
  );
  process.exit(1);
}

function parseArgs(argv) {
  const args = {};
  for (const arg of argv) {
    const match = arg.match(/^--([^=]+)=(.*)$/);
    if (match) args[match[1]] = match[2];
  }
  return args;
}

const MONTHS = 'Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec';
const NBSP = '\u00A0';

// The model tends to normalize a deliberate run of non-breaking spaces back down to a
// single regular space, which pandoc/CommonMark then collapses entirely, so the visual
// gap between a role's title and its dates has to be re-inserted deterministically here
// rather than trusted to survive the prompt round-trip.
function widenTitleDateGaps(markdown) {
  const pattern = new RegExp(`(\\*\\*[^\\n*]+\\*\\*)[ \\t]+(\\*\\*(?:${MONTHS})[a-z]* \\d{4}[^\\n*]*\\*\\*)`, 'g');
  return markdown.replace(pattern, (_match, title, dates) => `${title}${NBSP.repeat(4)}${dates}`);
}

function extractTitle(jobDescription) {
  const match = jobDescription.match(/^\s*job\s*title\s*:\s*(.+)$/im);
  return match ? match[1].trim() : null;
}

function localTimestamp() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}_${pad(d.getHours())}-${pad(d.getMinutes())}-${pad(d.getSeconds())}`;
}

function buildPrompt(template, jobDescription, title) {
  return `You are filling in a C2C (corp-to-corp contract) resume template for a senior-level candidate applying to a specific job. The template below fixes the section layout, contact info, employer names, and dates. Every placeholder wrapped in curly braces (e.g. "{Designation}", "{Skills}", "{At least 10 descriptive points}") must be replaced with real, specific content generated from the target job description. Do not leave any curly-brace placeholder in the output.

This candidate has 7+ years of experience and is targeting senior-level roles. Every bullet across every role must read as senior-level work: owning designs and architecture decisions, driving technical direction, leading initiatives end to end, influencing cross-team or cross-functional outcomes, mentoring others, and making tradeoff calls, not just implementing assigned tickets. Junior-sounding phrasing ("helped with", "assisted", "contributed to", "participated in", "learned") is not acceptable anywhere — use ownership language instead ("led", "drove", "architected", "owned", "spearheaded", "established", "drove alignment on").

Formatting rules:
- Keep the exact structure of the template: bold name/title/contact lines, "## SECTION NAME" markdown headings for section titles (do not convert these to bold text or a different heading level), bold role title + dates line, italicized company name line, bullet lists under each role.
- The role title and dates on each experience line are separated by several non-breaking space characters (not a single regular space) for visual spacing. Preserve that exact run of non-breaking spaces between "**{Designation}**" and the bold dates on every role line, do not collapse it to a single space.
- Replace "Senior {Designation}" in the header line with the seniority-appropriate title that best matches the target job description (e.g. "Senior Full Stack Developer", "Senior JavaScript Engineer", "Senior Backend Engineer").
- Replace each per-role "{Designation}" with a title that reflects a plausible seniority progression across the four roles, ending at the header title's level in the most recent (Texas Comptroller) role. The three older roles should carry the same technical discipline as the target JD but a notch below senior (e.g. "Full Stack Developer" or "Software Engineer") for the earliest two, stepping up toward "Senior" by the American Express role if warranted, so the story reads as steady growth into seniority, not four identical titles.
- Replace "{12 points that say seniority, breadth of tool usage, and share points even about outside-tech traits like behavioral/leadership}" with exactly 12 PROFESSIONAL SUMMARY bullets. These must cover, across the 12: years of experience and seniority framing, the target JD's core technologies, breadth across the full stack the JD implies, and at least 2-3 bullets on non-technical strengths (leadership, mentorship, ownership, stakeholder communication, driving ambiguous problems to resolution, cross-functional collaboration) — not purely a list of technologies.
- Replace "{Skills}" with a full technical skills section, grouped into short labeled categories (e.g. Languages, Frontend, Backend, Cloud/DevOps, Databases, Testing) covering everything the target JD asks for.
- Replace "{At least 14 descriptive points}" (Texas Comptroller role) with at least 14 senior-level bullets. Replace "{2 of these points should have metrics}" by ensuring exactly 2 of this role's bullets include a real, plausible quantified metric (percentage or number) — do not add metrics to any other bullet in this role.
- Replace each other "{At least 10 descriptive points}" with at least 10 bullets for that role, written at the seniority level assigned to that role's designation. These three older roles (American Express, Newgen Software, Signovate Technologies) must NOT contain any quantified metric — keep them as plain qualitative statements of what was built, led, or contributed.
- Never use an em dash (—) anywhere in the output. Use a regular hyphen, a comma, or rephrase the sentence instead.
- Every bullet point and every PROFESSIONAL SUMMARY sentence must end with a period ("."). Do not omit the trailing period on any bullet. Exception: the SKILLS section entries must NOT end with a period.

Content rules:
- Do not hedge anything with phrases like "working knowledge of", "familiar with", "exposure to", "explored", "experimented with", or "began learning". State every skill and bullet as applied, hands-on experience.
- Identify every distinct requirement the target job description names, including tools, technologies, patterns, and practices, not just named products (e.g. "circuit breakers", "feature flags", "contract testing", "idempotency" count just as much as "Kafka" or "Redis"). Weave these into the SKILLS section and into specific bullets using the same literal keyword the JD uses, since ATS keyword matching depends on literal terms being present, not vaguer paraphrases.
- Distribute the JD's named technologies/keywords unevenly across the four roles: the two most recent roles (Texas Comptroller and American Express) should make extensive, heavy use of the JD's literal keywords and technologies throughout their bullets. The two oldest roles (Signovate Technologies and Newgen Software) should include only some of the JD's technologies, not all of them, and should not be saturated with JD keywords the way the two recent roles are.
- Whenever a cloud provider is named or implied by the target JD (AWS, Azure, GCP, or similar), name the specific services that fit both the JD's stated needs and the work described in that bullet (e.g. "AWS Lambda, S3, and SQS"), rather than the bare provider name alone.
- Exception: if a requested skill is AI/ML related (e.g. LLMs, GenAI, AI agents, RAG, prompt engineering, ML pipelines, Copilot-style tooling), only add it to the Texas Comptroller role (the most recent), never to older roles, since broad industry AI adoption only started in 2025 and attributing it earlier is not plausible.
- Every role's bullets must include at least one clear leadership or ownership signal appropriate to that role's assigned seniority (e.g. drove architecture/design decisions, mentored other engineers, led a migration or initiative end to end, set technical direction, owned a system or workstream), scaling up in scope and autonomy from the earliest role to the most recent.
- Do not use the words "Led" or "Architected" (or "Lead"/"Architect" as a verb) anywhere in the three older roles (American Express, Newgen Software, Signovate Technologies). Use other ownership language there instead (e.g. "drove", "owned", "spearheaded", "established", "drove alignment on", "designed"). "Led" and "Architected" are reserved for the most recent role (Texas Comptroller) only.
- Never invent employers, dates, or degrees beyond what's in the template. Company names and dates are fixed facts; titles, summary, skills, and bullet content are fully generated to match the target JD and the seniority arc described above.
- Do not turn the JD's list of responsibilities/qualifications into a template stamped onto every role in the same order. Each role's bullets must read as that role's own distinct, organic experience: vary which JD requirements are emphasized, vary the order they're covered in, and vary sentence structure and phrasing from role to role. A reviewer scanning the four roles side by side should not see the same points repeated in the same sequence across all of them.

Before you output anything, act as an ATS (Applicant Tracking System) checker: silently read back your own draft, comparing all four roles' bullets side by side, and check specifically for bullets that map almost one-to-one, in the same order, across multiple roles (the JD's list copy-pasted as a template into every role instead of reading as distinct, organic experience). If you find that defect, rewrite the affected bullets before producing your final answer. Do this self-check internally, do not narrate it or show your draft.

Output ONLY the final filled-in resume as Markdown, matching the template's structure exactly with all placeholders replaced. No commentary, no code fences, no explanation before or after.

--- TEMPLATE (Markdown) ---
${template}

--- TARGET JOB ---
Title: ${title}
Description:
${jobDescription}
`;
}

function main() {
  const { title: titleArg } = parseArgs(process.argv.slice(2));

  if (!existsSync(jdPath)) {
    console.error(`Job description file not found at ${jdPath}`);
    process.exit(1);
  }
  const jobDescription = readFileSync(jdPath, 'utf8').trim();
  if (!jobDescription || jobDescription.startsWith('Paste the job description')) {
    console.error(`Paste the job description into ${jdPath} before running this script.`);
    process.exit(1);
  }

  const title = titleArg || extractTitle(jobDescription);
  if (!title) {
    console.error(
      `Could not find a "Job Title:" line in ${jdPath}. Add one, or pass --title="..." explicitly.`
    );
    process.exit(1);
  }

  if (!existsSync(templatePath)) {
    console.error(`Resume template not found at ${templatePath}`);
    process.exit(1);
  }
  const template = readFileSync(templatePath, 'utf8');
  const prompt = buildPrompt(template, jobDescription, title);

  const runDir = join(outputDir, localTimestamp());
  mkdirSync(runDir, { recursive: true });
  const mdPath = join(runDir, `${RESUME_DOCUMENT_NAME}.md`);
  const docxPath = join(runDir, `${RESUME_DOCUMENT_NAME}.docx`);

  console.log(`Calling ${AGENT_CLI} to tailor C2C resume...`);
  const tailored = execFileSync(agentCli.bin, agentCli.args(prompt), {
    encoding: 'utf8',
    maxBuffer: 10 * 1024 * 1024,
  });
  const finalMarkdown = widenTitleDateGaps(tailored.trim());
  writeFileSync(mdPath, finalMarkdown + '\n');
  console.log(`Wrote ${mdPath}`);

  const pandocArgs = [mdPath, '-o', docxPath];
  if (existsSync(referenceDocxPath)) {
    pandocArgs.push(`--reference-doc=${referenceDocxPath}`);
  }
  execFileSync('pandoc', pandocArgs);
  console.log(`Wrote ${docxPath}`);

  console.log(JSON.stringify({ mdPath, docxPath }));
}

main();
