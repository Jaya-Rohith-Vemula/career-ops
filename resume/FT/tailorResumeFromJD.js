import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { execFileSync } from 'child_process';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const outputDir = join(__dirname, 'output');
const baseResumePath = join(__dirname, 'base_resume.md');
const referenceDocxPath = join(__dirname, 'reference.docx');
const jdPath = join(__dirname, 'current-jd.txt');

// process.env isn't populated from .env by anything else in this codebase —
// load it directly so RESUME_DOCUMENT_NAME takes effect when set there.
try {
  process.loadEnvFile(join(__dirname, '..', '..', '.env'));
} catch {
  // .env is optional — real env vars (e.g. in production) take precedence anyway
}

const RESUME_DOCUMENT_NAME = process.env.RESUME_DOCUMENT_NAME;
if (!RESUME_DOCUMENT_NAME) {
  console.error('RESUME_DOCUMENT_NAME must be set in .env or the environment');
  process.exit(1);
}

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

function slugify(text) {
  return String(text).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
}

function extractField(text, label) {
  const match = text.match(new RegExp(`^\\s*${label}\\s*:\\s*(.+)$`, 'im'));
  return match ? match[1].trim() : null;
}

const META_DELIMITER = '<<<JOB_META>>>';

function splitResumeAndMeta(response) {
  const idx = response.indexOf(META_DELIMITER);
  if (idx === -1) return { resumeMarkdown: response.trim(), title: null, companyName: null };
  const resumeMarkdown = response.slice(0, idx).trim();
  const meta = response.slice(idx + META_DELIMITER.length);
  return {
    resumeMarkdown,
    title: extractField(meta, 'title'),
    companyName: extractField(meta, 'company'),
  };
}

function localTimestamp() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}_${pad(d.getHours())}-${pad(d.getMinutes())}-${pad(d.getSeconds())}`;
}

function buildPrompt(resume, job) {
  return `You are tailoring a software engineer's resume for a specific job application. The base resume below is only a structural template: it fixes the section layout, the employer names, job titles, dates, and the real metrics/numbers the candidate can legitimately claim. The specific technologies, skills, and phrasing it currently uses are NOT authoritative and are not required to survive into the output. Your job is to rebuild the SKILLS and EXPERIENCE content from scratch so it reads as a natural fit for the target job description, discarding any base-resume technology that isn't relevant to that JD. Make the resume very job specific: if the JD is FE, rewrite it FE; if full stack, make it full stack; if BE, make it ONLY BE focused. Keep the same overall structure (summary, skills, experience, education), and keep contact info unchanged. The output must fill exactly one full page, no more and no less: write enough bullets and detail across SUMMARY/SKILLS/EXPERIENCE to occupy the entire page.

Formatting rules:
- Keep the exact markdown heading levels from the base resume: "# NAME" for the name line, "## SECTION" for each section title (SUMMARY, SKILLS, EXPERIENCE, EDUCATION). Do not convert these to bold text.
- Keep the "::: {custom-style=\"ContactInfo\"} ... :::" fenced div wrapper around the contact line exactly as-is, with the contact details unchanged inside it.
- Never use an em dash (—) anywhere in the output. Use a regular hyphen, a comma, or rephrase the sentence instead.
- Write every EXPERIENCE bullet in past tense (e.g. "Managed", "Led", "Developed", "Built"), including bullets under the current/most recent role. Do not use present-tense verbs ("Manage", "Lead", "Develop") anywhere in EXPERIENCE, regardless of whether the role is ongoing.

Content rules:
- Do not hedge anything with phrases like "working knowledge of", "familiar with", "exposure to", "explored", "experimented with", or "began learning". State every skill and bullet as applied, hands-on experience, not something the candidate merely tried.
- The SKILLS section must be rebuilt around the target JD, not merely appended to: drop any category or item from the base resume's SKILLS that the target JD doesn't call for and isn't adjacent to what it calls for, and replace it with the JD's actual required skills.
- Identify every distinct requirement the target job description names, including tools, technologies, patterns, and practices, not just named products (e.g. "circuit breakers", "feature flags", "contract testing", "idempotency" count just as much as "Kafka" or "Redis"). Split these into core requirements (the primary language/framework/platform the JD centers on, e.g. something it calls "the foundation of our stack" or lists first/repeatedly as required) versus secondary requirements (supporting tools, practices, or nice-to-haves).
- Secondary requirements only need to appear by name once each, in the SKILLS section and in a bullet in at least one EXPERIENCE entry, stated as tech/practice the candidate has and has used, not as something explored or applying to learn.
- Within core requirements, distinguish named technologies/platforms (e.g. C#, .NET, SQL Server, Kafka) from broad competency/paradigm phrases (e.g. "object-oriented programming", "distributed systems", "test-driven development"). Named technologies must appear by name in the SKILLS section and be woven into a bullet in EVERY EXPERIENCE entry where it's plausible for that era and seniority (not just the most recent one) — a single one-off mention undersells depth and reads as if the candidate only recently touched the JD's primary stack. Broad competency phrases should be stated once, in the SUMMARY or one SKILLS/EXPERIENCE bullet, and elsewhere demonstrated through the substance of what the bullet describes (e.g. class design, interfaces, service boundaries, encapsulation) rather than by repeating the same buzzword phrase in every bullet, which reads as forced and redundant.
- Whenever a cloud provider is named or implied by the target JD (AWS, Azure, GCP, or similar), never write just the bare provider name in SKILLS or a bullet. Name the specific services that fit both the JD's stated needs and the work described in that bullet (e.g. "AWS Lambda, S3, and SQS" or "Azure Functions and Service Bus" or "GCP Cloud Run and Pub/Sub"), picking services that are plausible for the task at hand (compute, storage, messaging, etc. as the bullet's context calls for) rather than an arbitrary or repeated fixed list. If the JD itself names specific services, use those exact service names; otherwise infer the services that best match the surrounding work in the bullet and the provider's real service catalog. Apply this in the SKILLS section and in every EXPERIENCE bullet that mentions the provider.
- Once a core named technology replaces an older one in a bullet, do not keep both the old and new technology side by side (e.g. do not write "C#/.NET and Java") unless the target JD itself explicitly asks for experience across multiple such languages/stacks. Pick the one the JD calls for and drop the other, even if the old one is a plausible complement.
- It's fine to bundle several of these requirements into one bullet/sentence, but every one of them must appear using the same or closely matching keyword, not folded into a vaguer summary phrase. For example if the job description names four things (say Kafka, ActiveMQ, circuit breakers, and idempotency), the bullet must contain those four terms, not a generic phrase like "reliable messaging" that drops the specific keywords. ATS keyword matching depends on the literal terms being present.
- Exception: if a requested skill is AI/ML related (e.g. LLMs, GenAI, AI agents, RAG, prompt engineering, ML pipelines, Copilot-style tooling), only add it to the single most recent EXPERIENCE entry (the first one listed), never to the second-most-recent or older entries, since broad industry AI adoption only started in 2025 and attributing it earlier is not plausible.
- For every EXPERIENCE entry (not just the most recent ones), replace base-resume technology names that are irrelevant to the target JD with the JD's relevant technologies, rewriting the bullet around the new tech while keeping the underlying action and outcome (what was built, improved, or delivered) plausible for that role and era. Do not leave old, off-target technology names (e.g. a frontend framework) sitting in a bullet just because it was in the original resume, when the target JD calls for a different stack.
- If the target job description emphasizes behavioral or soft-skill traits (e.g. ownership, mentorship, leadership, cross-functional collaboration, communication, comfort with ambiguity, working with minimal process), reflect at least one of them explicitly, either in the SUMMARY or in a relevant EXPERIENCE bullet.
- If a job title in the base resume explicitly names a discipline (e.g. "Frontend Engineer", "Backend Engineer") that contradicts the focus of the target job, update that title to match (e.g. to "Full Stack Engineer" or "Backend Engineer") so the listed title doesn't contradict the tailored bullets underneath it. Keep the company name and dates unchanged. Apply this to every EXPERIENCE entry whose title contradicts the target focus, not just the most recent ones.
- Quantified metrics belong in the two most recent EXPERIENCE entries. Every metric used must trace back to a real number/percentage from the base resume; distribute them across those two entries only, attaching each to whichever bullet there is most relevant to the target job's core requirements, even if that means moving a metric off the bullet it originally sat on and rewriting that bullet's technology around the new context. Don't leave the bullets that matter most for this job with no metric while a less relevant bullet in one of those two entries keeps one.
- You may rescale or reframe a base-resume metric to fit its new bullet's context, as long as it stays tied to the same real underlying achievement: convert units/framing naturally (e.g. a general "reduced processing time 30%" can become "cut p95 API latency by 30%" if the new bullet is about API latency), and nudge the magnitude within a plausible range of the original (e.g. 30% -> anywhere roughly 25-35%) rather than using the exact original figure verbatim every time. Do not multiply a metric into a wildly different scale (e.g. 30% becoming 300%, or "5 engineers" becoming "50 engineers"), and never attach a metric to a bullet describing work that has no real counterpart in the base resume for that number. Bullets that had no metric in the base resume stay unquantified; do not manufacture a new one for them.
- Never invent employers, job titles' companies, or projects that are not in the base resume below. Company names, titles-as-a-starting-point, and dates are the only fixed facts; the technical content describing the work is fully rewritable to match the target JD.
- Identify every technology the target JD marks as preferred, nice-to-have, a plus, or bonus (as distinct from required/must-have). Every one of these preferred items must appear in full in the SKILLS section AND be woven naturally into at least one bullet of the most recent (latest) EXPERIENCE entry specifically, stated as tech the candidate actually used there, not flagged as optional or secondary. Place each one inside a bullet where it plausibly supports the work described (e.g. alongside the tool/task it would realistically pair with), not tacked onto the end of a sentence as a bare keyword list. Do not confine preferred items to a role's stretch or exploratory language; they must read as normal, applied experience.
- Every bullet point sentence must end with a period ("."). Do not omit the trailing period on any bullet. Exception: the SKILLS section entries must NOT end with a period.
- Write in a natural, human-written style that reflects how an experienced professional would describe their work. Avoid AI-sounding buzzwords, repetitive sentence patterns, generic filler, and overly polished marketing language. Vary sentence openings, action verbs, and structure so the resume reads authentically.

Before finalizing your output, perform this self-check internally (do not show this process, its scoring, or any commentary about it in your final answer):
1. List every keyword/requirement (required and preferred) the target JD names: named technologies, tools, platforms, practices, and competency phrases.
2. Check the drafted resume against that list and estimate the percentage of those keywords present verbatim (an ATS keyword match score).
3. If the estimate is below 95%, revise the SKILLS section and/or relevant EXPERIENCE bullets to naturally incorporate the missing keywords, following all the content rules above (correct era/entry placement, no dropped core tech, no invented employers/metrics). Repeat this check-and-revise step until the estimate reaches 95% or you've made every plausible improvement without violating a rule above.
4. Only once satisfied, output the final resume as your answer — never include the checklist, the score, or any note about having performed this check.

Output the tailored resume as Markdown, with no commentary, code fences, or explanation before or after it. Then, after the resume, on a new line output exactly the literal marker \`${META_DELIMITER}\` followed by two lines:
Title: <the job title>
Company: <the hiring company's name>
${job.title ? `Use "${job.title}" verbatim as the title.` : 'The title was not given above — determine it from the job description below.'}
${job.companyName ? `Use "${job.companyName}" verbatim as the company.` : 'The company name was not given above — determine it from the job description below.'}

--- BASE RESUME (Markdown) ---
${resume}

--- TARGET JOB ---
${job.title ? `Title: ${job.title}\n` : ''}${job.companyName ? `Company: ${job.companyName}\n` : ''}Description:
${job.description || '(no description available)'}
`;
}

function main() {
  const { title: titleArg, company: companyArg } = parseArgs(process.argv.slice(2));

  if (!existsSync(jdPath)) {
    console.error(`Job description file not found at ${jdPath}`);
    process.exit(1);
  }
  const jobDescription = readFileSync(jdPath, 'utf8').trim();
  if (!jobDescription || jobDescription.startsWith('Paste the job description')) {
    console.error(`Paste the job description into ${jdPath} before running this script.`);
    process.exit(1);
  }

  const titleHint = titleArg || extractField(jobDescription, 'job\\s*title');
  const companyHint = companyArg || extractField(jobDescription, 'company');

  if (!existsSync(baseResumePath)) {
    console.error(`Base resume not found at ${baseResumePath}`);
    process.exit(1);
  }
  const resume = readFileSync(baseResumePath, 'utf8');
  const job = { title: titleHint, companyName: companyHint, description: jobDescription };
  const prompt = buildPrompt(resume, job);

  console.log(`Calling ${AGENT_CLI} to tailor resume...`);
  const response = execFileSync(agentCli.bin, agentCli.args(prompt), {
    encoding: 'utf8',
    maxBuffer: 10 * 1024 * 1024,
  });
  const { resumeMarkdown, title: parsedTitle, companyName: parsedCompany } = splitResumeAndMeta(response);

  const title = titleHint || parsedTitle;
  const companyName = companyHint || parsedCompany || 'Target Company';
  if (!title) {
    console.error(
      `Could not determine the job title from ${jdPath} or the model's response. Pass --title="..." explicitly.`
    );
    process.exit(1);
  }

  const slug = `${slugify(companyName)}-${slugify(title)}-${localTimestamp()}`;
  const runDir = join(outputDir, slug);
  mkdirSync(runDir, { recursive: true });
  const mdPath = join(runDir, `${RESUME_DOCUMENT_NAME}.md`);
  const docxPath = join(runDir, `${RESUME_DOCUMENT_NAME}.docx`);

  writeFileSync(mdPath, resumeMarkdown + '\n');
  console.log(`Wrote ${mdPath}`);

  const pandocArgs = [mdPath, '-o', docxPath];
  if (existsSync(referenceDocxPath)) {
    pandocArgs.push(`--reference-doc=${referenceDocxPath}`);
  }
  execFileSync('pandoc', pandocArgs);
  console.log(`Wrote ${docxPath}`);

  console.log(JSON.stringify({ slug, mdPath, docxPath }));
}

main();
