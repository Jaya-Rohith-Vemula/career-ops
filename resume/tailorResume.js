import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { execFileSync } from 'child_process';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { getJob } from '../db/client.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const outputDir = join(__dirname, 'output');
const baseResumePath = join(__dirname, 'base_resume.md');
const referenceDocxPath = join(__dirname, 'reference.docx');

// process.env isn't populated from .env by anything else in this codebase —
// load it directly so RESUME_DOCUMENT_NAME takes effect when set there.
try {
  process.loadEnvFile(join(__dirname, '..', '.env'));
} catch {
  // .env is optional — real env vars (e.g. in production) take precedence anyway
}

const RESUME_DOCUMENT_NAME = process.env.RESUME_DOCUMENT_NAME;
if (!RESUME_DOCUMENT_NAME) {
  console.error('RESUME_DOCUMENT_NAME must be set in .env or the environment');
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

function buildPrompt(resume, job) {
  return `You are tailoring a software engineer's resume for a specific job application. The base resume below is only a structural template: it fixes the section layout, the employer names, job titles, dates, and the real metrics/numbers the candidate can legitimately claim. The specific technologies, skills, and phrasing it currently uses are NOT authoritative and are not required to survive into the output. Your job is to rebuild the SKILLS and EXPERIENCE content from scratch so it reads as a natural fit for the target job description, discarding any base-resume technology that isn't relevant to that JD. Make the resume very job specific: if the JD is FE, rewrite it FE; if full stack, make it full stack; if BE, make it ONLY BE focused. Keep the same overall structure (summary, skills, experience, education), keep it to one page worth of content, and keep contact info unchanged.

Formatting rules:
- Keep the exact markdown heading levels from the base resume: "# NAME" for the name line, "## SECTION" for each section title (SUMMARY, SKILLS, EXPERIENCE, EDUCATION). Do not convert these to bold text.
- Keep the "::: {custom-style=\"ContactInfo\"} ... :::" fenced div wrapper around the contact line exactly as-is, with the contact details unchanged inside it.
- Never use an em dash (—) anywhere in the output. Use a regular hyphen, a comma, or rephrase the sentence instead.

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
- Quantified metrics only belong in the two most recent EXPERIENCE entries. Preserve every real number/percentage from the base resume and distribute them across those two entries only, attaching each to whichever bullet there is most relevant to the target job's core requirements, even if that means moving a metric off the bullet it originally sat on and rewriting that bullet's technology around the new context. Don't leave the bullets that matter most for this job with no metric while a less relevant bullet in one of those two entries keeps one. Never invent a number that isn't in the base resume below.
- The two older EXPERIENCE entries (third and fourth listed) should not carry any quantifying metric, even if the base resume has one attached there. Rewrite those bullets as plain, qualitative statements of what was built or contributed, and move any real number that originally lived on one of those bullets to a relevant bullet in one of the two most recent entries instead of dropping it.
- Never invent employers, job titles' companies, or projects that are not in the base resume below. Company names, titles-as-a-starting-point, and dates are the only fixed facts; the technical content describing the work is fully rewritable to match the target JD.

Output ONLY the tailored resume as Markdown. No commentary, no code fences, no explanation before or after.

--- BASE RESUME (Markdown) ---
${resume}

--- TARGET JOB ---
Title: ${job.title}
Company: ${job.companyName}
Description:
${job.description || '(no description available)'}
`;
}

function main() {
  const { companyId, jobId } = parseArgs(process.argv.slice(2));
  if (!companyId || !jobId) {
    console.error('Usage: node resume/tailorResume.js --companyId=<id> --jobId=<id>');
    process.exit(1);
  }

  const job = getJob(Number(companyId), jobId);
  if (!job) {
    console.error(`Job not found: companyId=${companyId} jobId=${jobId}`);
    process.exit(1);
  }

  if (!existsSync(baseResumePath)) {
    console.error(`Base resume not found at ${baseResumePath}`);
    process.exit(1);
  }
  const resume = readFileSync(baseResumePath, 'utf8');
  const prompt = buildPrompt(resume, job);

  const slug = `${slugify(job.companyName)}-${slugify(job.title)}-${slugify(job.jobId)}`;
  const runDir = join(outputDir, slug);
  mkdirSync(runDir, { recursive: true });
  const mdPath = join(runDir, `${RESUME_DOCUMENT_NAME}.md`);
  const docxPath = join(runDir, `${RESUME_DOCUMENT_NAME}.docx`);

  console.log('Calling claude to tailor resume...');
  const tailored = execFileSync('claude', ['-p', prompt], {
    encoding: 'utf8',
    maxBuffer: 10 * 1024 * 1024,
  });
  writeFileSync(mdPath, tailored.trim() + '\n');
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
