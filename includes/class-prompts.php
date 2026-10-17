<?php
/**
 * Default prompt templates for the article steps. Each website can override them.
 *
 * Placeholders in {{double braces}} are filled in by the app when you press "Copy prompt".
 * {{context}} is built from the website settings (site, audience, language, tone, style
 * guide and a short piece of an example article).
 *
 * @package ContentPipeline
 */

namespace ContentPipeline;

defined( 'ABSPATH' ) || exit;

/**
 * Prompt defaults.
 */
final class Prompts {

	/**
	 * Steps that have a prompt, in order, with their labels.
	 *
	 * @return array<string, string>
	 */
	public static function steps(): array {
		return array(
			'cleanup'    => __( 'Cleanup', 'content-pipeline' ),
			'outline'    => __( 'Outline', 'content-pipeline' ),
			'section'    => __( 'Draft (one section)', 'content-pipeline' ),
			'polish'     => __( 'Polish', 'content-pipeline' ),
			'seo'        => __( 'SEO fields', 'content-pipeline' ),
			'styleguide' => __( 'Style guide from examples', 'content-pipeline' ),
		);
	}

	/**
	 * Blog Kit boxes the AI may use, written as :::name … ::: in Markdown.
	 *
	 * @return array<string, string>
	 */
	public static function boxes(): array {
		return array(
			'quick-answer' => __( 'Quick answer (short answer at the top)', 'content-pipeline' ),
			'takeaways'    => __( 'Key takeaways (list near the end)', 'content-pipeline' ),
			'tip'          => __( 'Tip', 'content-pipeline' ),
			'warning'      => __( 'Warning', 'content-pipeline' ),
			'note'         => __( 'Note', 'content-pipeline' ),
			'checklist'    => __( 'Checklist', 'content-pipeline' ),
			'faq'          => __( 'FAQ (questions and answers)', 'content-pipeline' ),
		);
	}

	/**
	 * Phrases that make text sound machine-written (default "avoid" list).
	 *
	 * @return string[]
	 */
	public static function ai_phrases(): array {
		return array(
			"in today's fast-paced world",
			'in the ever-evolving',
			'delve',
			'dive into',
			"it's important to note",
			'it is important to note',
			'in conclusion',
			'unlock the',
			'unleash',
			'game-changer',
			'navigate the',
			'embark on',
			'tapestry',
			'in the realm of',
			'elevate your',
			'seamless',
			'leverage',
			'look no further',
			'when it comes to',
			'a testament to',
			'plays a crucial role',
			'whether you are a',
		);
	}

	/**
	 * Default templates.
	 *
	 * @return array<string, string>
	 */
	public static function defaults(): array {
		return array(
			'cleanup'    => <<<'TXT'
{{context}}

TASK: Clean up my rough note into clear notes for an article.
- Fix spelling and grammar, write out short forms, and group related ideas.
- Keep every idea from my note. Do not add new facts, numbers, names or claims.
- Where something important is missing, add a line: [NEEDS DETAIL: what is missing]
- First line: a working title, written as: Title: ...
Return only the title line and the cleaned notes as a bullet list.

MY NOTE:
"""
{{note}}
"""
TXT
			,
			'outline'    => <<<'TXT'
{{context}}

TASK: Create an outline for an article of about {{words}} words, based on the notes below.
Rules:
- 4 to 8 sections. The first section introduces the reader's problem; the last one wraps up with next steps.
- Every section has a clear, specific heading (no clickbait) and one sentence on what it covers.
- Give every section a word count; together about {{words}} words.
{{faq_rule}}
Return ONLY this format, nothing before or after it:

## Heading of the section
Brief: what this section covers
Words: 200

(repeat for every section)

NOTES:
"""
{{cleanup}}
"""
TXT
			,
			'section'    => <<<'TXT'
{{context}}

TASK: Write ONE section of the article "{{title}}".
Section heading: {{heading}}
What it covers: {{brief}}
Length: about {{section_words}} words.

Full outline (write only the section above):
{{outline}}

{{previous}}

Rules:
- Write only the text of this section. Do not repeat the section heading.
- Short paragraphs of 2–4 sentences. Use ### subheadings, bullet lists or numbered steps where they help the reader.
- Do not invent facts, numbers, laws, salaries, company names, studies or quotes. Where a real fact is needed, write [NEEDS DETAIL: what is needed]
{{boxes_rule}}
- Avoid these phrases: {{banned}}
- Write in Markdown.

SOURCE NOTES:
"""
{{cleanup}}
"""
TXT
			,
			'polish'     => <<<'TXT'
{{context}}

TASK: Polish this article draft so it reads as if an experienced human writer wrote it for this audience.
- Keep all facts, the order of the sections and the meaning. Do not add new facts.
- Remove filler and phrases that sound machine-written, for example: {{banned}}
- Mix short and longer sentences. Prefer simple, direct words and active voice.
- Start the introduction with the reader's situation or problem, not with a general statement.
- Keep every [NEEDS DETAIL: …] marker exactly as it is.
{{boxes_rule}}
- Keep the Markdown: ## for sections, ### for subheadings, - for lists.
Return the full article in Markdown, starting with the first section. Do not add a title line.

DRAFT:
"""
{{draft}}
"""
TXT
			,
			'seo'        => <<<'TXT'
{{context}}

TASK: Write the SEO fields for this article.
Return ONLY these 5 lines:
SEO title: (50–60 characters, main keyword near the start)
Meta description: (140–155 characters, plain and specific, makes people want to click, no clickbait)
Slug: (3–6 lowercase words joined with hyphens)
Focus keyword: (the main phrase people search for)
Excerpt: (1–2 sentences for the blog listing)

ARTICLE:
"""
{{article}}
"""
TXT
			,
			'styleguide' => <<<'TXT'
TASK: Study the example articles below and write a style guide that another writer can follow to write NEW articles in the same style for the website "{{site}}".
Cover: audience and reading level; tone and voice; typical structure; how introductions start; paragraph and sentence length; use of headings, lists and boxes; words and phrases to use and to avoid; how advice, examples and numbers are given.
Write short bullet points, at most 300 words. Do not copy sentences from the examples.

EXAMPLES:
{{examples}}
TXT
			,
		);
	}
}
