# Lessons from "Style: Lessons in Clarity and Grace"

Summary of Joseph M. Williams' principles (later editions with Joseph Bizup), paraphrased for coaching. Each lesson has the principle, diagnostic tests, revision moves, and exceptions.

The general method for every lesson: **diagnose, analyze, revise.** Find the symptom with a mechanical test. Name the cause. Revise from the cause.

---

## Lesson 1: Understanding style

- Unclear writing has causes: writers who know their subject too well forget what readers do not know; writers who are new to a field imitate its worst prose; writers draft to think, then fail to revise for readers.
- Judge prose by how readers experience it, not by a list of rules.
- Revision is where clarity happens. A first draft that serves the writer is normal.

## Lesson 2: Correctness

Sort rules into three groups:

- **Real rules**: breaking them marks the writer as careless. Examples: subject–verb agreement, dangling modifiers that mislead, wrong pronoun case, sentence fragments that confuse.
- **Folklore**: rules that careful writers break all the time. Do not enforce:
  - Do not begin a sentence with *and*, *but*, *so*, or *because*.
  - Do not split an infinitive.
  - Do not end a sentence with a preposition.
  - Use *which* only for nonrestrictive clauses (US style prefers *that* for restrictive, but *which* is not an error).
  - Do not use the first person.
  - *None* is always singular.
- **Optional rules**: formal registers may observe them (e.g., avoid contractions, *whom* in object position). Follow the venue.

Coach move: when the user asks about a rule, say which group it belongs to.

## Lesson 3: Actions

**Principle:** Readers understand a sentence faster when its main characters are subjects and its important actions are verbs.

**Diagnostic test:**

1. Underline the first six or seven words of each sentence.
2. Mark the simple subject. Is it a character (a person, group, or concrete thing that acts)?
3. Find the actions. Are they verbs, or nouns (nominalizations) and adjectives?

**Nominalization:** a verb or adjective turned into a noun. *decide → decision*, *fail → failure*, *discover → discovery*, *careful → care*, *applicable → applicability*.

Common patterns and fixes:

| Pattern | Example | Revision |
| --- | --- | --- |
| Nominalization is subject of an empty verb | *The intention of the committee is to audit…* | *The committee intends to audit…* |
| Nominalization follows an empty verb | *The agency **conducted an investigation** into…* | *The agency investigated…* |
| Nominalization follows *there is/are* | *There is a need for further study.* | *We must study this further.* |
| Two nominalizations in a row | *Our **loss** was due to **failure** of the system.* | *We lost because the system failed.* |
| Two nominalizations joined by a preposition | *the **review** of the **implementation***| *when we reviewed how they implemented…* |

**Revision moves:**

1. Find the characters. If they are missing, supply them (often *we*, *you*, *the user*, *the team*).
2. Find the actions, even when they hide in nouns.
3. Make characters subjects and actions verbs.
4. Rebuild with subordinating conjunctions (*because, although, when, if, how, why*) to show logic that was hidden in prepositions (*due to, in regard to, by means of*).

**Keep nominalizations when they:**

- refer back to the previous sentence (*These **arguments** all depend on…*),
- name what would otherwise need a whole clause (*The fact that she denied it…* → *Her **denial**…*),
- name the object of a verb (*I do not know what she intends* → *I do not know her **intention***),
- name a familiar concept the reader knows as a noun (*taxation, freedom, latency, deployment*).

## Lesson 4: Characters

**Principle:** Make the main characters short, specific subjects. Readers expect the subject to name who or what the sentence is about.

**Diagnostic:** Who is this passage about? Does that character appear as the subject in most sentences? Or is it hidden in a possessive, a prepositional phrase, or a *by*-phrase?

**Abstractions as characters:** When the story is about a concept (e.g., *memory safety*, *the market*), the concept can be the main character. Keep it consistent as the subject, and make its partners concrete.

**Active vs. passive.** Choose by asking:

1. Must readers know who does the action? If not, a passive can be fine.
2. Does the passive keep the topic string consistent?
3. Does the passive put old information first and new information last?

Use the passive when it serves these. Use the active otherwise.

Science and technical writing often use passives to keep the focus on the thing studied. Accept this when it keeps the topic consistent. Prefer *we* for the researchers' own actions where the venue allows it.

**Noun strings:** break up chains of nouns (*early childhood thought disorder misdiagnosis*) by starting from the last noun and unpacking with prepositions or verbs (*doctors misdiagnose disordered thought in young children*).

## Lesson 5: Cohesion and coherence

**Cohesion** is how sentences connect. **Coherence** is how the whole passage adds up.

**Old before new:** Start each sentence with information the reader already knows (from the previous sentence or common knowledge). End it with new information. This makes a flow from sentence to sentence.

**Topics:** The topic is the psychological subject: what the sentence is about. It is usually the grammatical subject near the start.

**Diagnostic test (topic string):**

1. Underline the first six or seven words of each sentence in a paragraph.
2. Do the underlined words name a small set of related characters or concepts?
3. Do they name the characters that the reader would call the paragraph's subject?

If the topics jump around, the paragraph feels choppy even when each sentence is clear.

**Revision moves:**

- Pick the few characters the paragraph is about. Make them the topics.
- Move old information to the front; use a passive when it helps.
- Use a short introductory phrase to connect to the previous sentence (*In this case*, *As a result*), but keep it short.

**Coherence checks:**

- Name the main topics of a passage. Do they appear in the topic strings?
- Are the key terms consistent (same word for the same thing)? Do not vary synonyms for elegance in expository writing.

## Lesson 6: Emphasis

**Principle:** The end of a sentence is the **stress position**. Readers expect the most important, new, or complex information there.

**Diagnostic:** Read the last three or four words of each sentence. Are they the words that deserve emphasis? Or trivial trailing phrases (*in this area*, *at the present time*, *for the most part*)?

**Revision moves:**

- Cut trailing filler.
- Move peripheral information to the left.
- Move new information to the right.
- Use *there is/are* or a passive to push new information to the end, when needed.
- Use *what*-clefts and *it*-clefts sparingly: *What we need is…*, *It is the cost that…*.
- Put the technical term being introduced at the end of its sentence the first time you use it. Next time it becomes old information and can go at the start.

**Complexity at the end:** Put long, complex phrases and clauses at the end, after the subject and verb. Short before long.

## Lesson 7: Motivation

**Principle:** Readers read closely only when they see a problem they care about. An introduction motivates them.

**Structure of an introduction:**

1. **Shared context** (optional): something the readers already know or believe. Often a common view the writer will then disturb.
2. **Problem**:
   - **Condition**: a situation, a gap, or something unknown.
   - **Cost / consequence**: why that condition matters to these readers. Answers "So what?"
3. **Solution / main point**: the answer, claim, or request. Often the last sentence of the introduction.

**Two kinds of problems:**

- **Practical**: a condition in the world costs someone something. Solution: an action.
- **Conceptual**: something we do not know or understand. The cost is a larger thing we cannot understand as a result. Solution: new knowledge.

**Diagnostic:**

1. Mark the end of the introduction. Can the user draw a line there?
2. Find the condition and the cost. Is the cost stated, or only implied?
3. Is the main point in the last sentence or two of the introduction?

**Conclusions:** State the main point again (if it came early), add its significance, and suggest what is still unknown or what to do next.

**Short forms:** In emails, memos, and short docs, the introduction can be one sentence: condition + cost + point.

## Lesson 8: Global coherence

**Principle:** Readers understand a document when they know its point early and see how each part relates to it.

**Issues and discussions:** Each unit (whole document, section, paragraph) has a short **issue** at the start (a sentence or two that frames it) and a **discussion** that develops it. The point of each unit is usually at the end of its issue.

**Point first or point last:**

- Put the point at the end of the introduction in most expository writing.
- Put the point at the end of the document only when there is a reason (e.g., to lead a hostile reader through evidence). Even then, state the problem early and say that a point is coming.

**Themes:** The main point should name the key concepts (themes) that the document develops. Readers use those words to track the discussion.

**Diagnostic:**

1. Draw a line after the issue of each section and each paragraph.
2. Does each issue state the point of its unit?
3. Do the key terms from the main point appear in each issue?
4. Is the order of sections logical and signaled (chronological, general to specific, familiar to unfamiliar, less to more important)?

**Revision moves:**

- Write a one-sentence point for each section. Put it at the start.
- Make the main point name the themes; repeat those words in section issues.
- Add a short map (sequence of sections) in long documents when readers need it.

## Lesson 9: Concision

**Principle:** Say what you mean in as few words as the reader needs. Cut words that do no work.

**What to cut:**

| Category | Examples |
| --- | --- |
| Meaningless words | *kind of, actually, really, basically, generally, certain, various, virtually, individual, specific, particular* |
| Redundant pairs | *full and complete, each and every, first and foremost, hopes and desires* |
| Redundant modifiers | *completely finish, past memories, future plans, terrible tragedy, true facts* |
| Redundant categories | *large in size, red in color, period of time, of an uncertain condition* |
| What readers infer | *As you know*, obvious details |
| Phrases for words | *due to the fact that → because*; *in the event that → if*; *at this point in time → now*; *has the ability to → can* |
| Negatives | *not many → few*; *not different → similar*; *did not remember → forgot* |

**Metadiscourse:** language about the writing or the writer's thinking (*I will argue*, *In this section*, *It is important to note that*, *It seems that*).

- Keep metadiscourse that orients readers in long documents (announcing the point, the plan).
- Cut metadiscourse that only narrates thinking or attributes (*It is interesting to note that…*).

**Hedges and intensifiers:**

- **Hedges** (*perhaps, may, seems, suggests, usually, to some extent*): keep when uncertainty is real and honest. Cut when they cover every claim.
- **Intensifiers** (*very, clearly, obviously, certainly, undoubtedly, key, crucial*): cut most. They often signal the writer's anxiety and make readers doubt.
- Aim for confident claims with the right qualification. A careful writer hedges the claims that need it.

**Caution:** Do not cut until the prose is terse or rude. Concision serves clarity.

## Lesson 10: Shape

**Principle:** A long sentence can be clear if the reader reaches the subject and verb quickly and the rest flows in readable chunks.

**Diagnostic for long sentences:**

1. **Long introductory phrases before the subject.** Move them or break them up. Keep introductions short.
2. **Long subjects.** Turn the subject into a clause, or move the long part to the end.
3. **Interruptions between subject and verb** or verb and object. Move the interrupting phrase to the front or end.
4. **Sprawl**: many clauses stacked after the verb with no structure. Break into sentences or reshape with the modifiers below.

**Ways to extend a sentence gracefully:**

- **Resumptive modifier:** repeat a key word, then continue. *Our plan relies on caching, **caching that** only works when reads outnumber writes.*
- **Summative modifier:** sum up the preceding clause in a noun, then continue. *Latency dropped by half, **a change that** users noticed within a day.*
- **Free modifier:** a phrase at the end that comments on the subject of the clause. *The team rewrote the parser, **cutting** build times in half.*
- **Coordination:** join parallel elements with *and, or, but*. Put the shorter element first and the longer, more complex one last.

**Sentence length:** Vary it. Break a long sentence when the reader must hold more than one open idea. Combine short sentences when they sound choppy or hide the logic between them.

## Lesson 11: Elegance

Apply only after the prose is clear and coherent.

- **Balance and symmetry:** coordinate parallel elements with parallel grammar. *Not to praise him, but to bury him.*
- **Climactic emphasis:** end with the longest, strongest, or most important element. Order items short to long, less to more important.
- **Chiasmus:** reverse the order in a second clause for effect. Use rarely.
- **Figurative language:** a precise metaphor can clarify. A mixed or tired metaphor distracts.
- **Sound and rhythm:** read the sentence aloud. Stress should fall on the words that matter.

**Caution:** Elegance that calls attention to itself can hurt clarity. In technical writing, use it for key claims and conclusions only.

## Lesson 12: The ethics of style

- **Principle:** Write to others as you would have others write to you.
- Writers have a duty to be as clear as their subject allows. Deliberate obscurity (to hide responsibility, inflate importance, or exclude readers) is an ethical failure.
- **Flags:** passives and nominalizations that hide who did something (*Mistakes were made*); jargon used to impress, not to inform; hedges that avoid commitment to a claim the writer holds; euphemisms for bad news.
- Some subjects are hard. Complex prose can be justified when the ideas are complex. It is not justified when simple ideas are dressed up.

---

## Full-document checklist

Run in order. Stop and revise when a level fails.

1. **Readers and purpose** are known.
2. **Introduction**: context → condition → cost → point. The point names the themes.
3. **Sections**: each opens with an issue that states its point, in the theme words.
4. **Paragraphs**: each has a clear issue; topic strings are consistent.
5. **Sentences**: characters are subjects; actions are verbs; old before new; stress position holds the key info.
6. **Concision**: cut redundancy, filler, excess metadiscourse, hedges, and intensifiers.
7. **Shape**: reach subject and verb fast; long sentences use resumptive, summative, or free modifiers; short before long.
8. **Elegance**: balance and climax where they help.
9. **Correctness**: real errors fixed; folklore ignored.
10. **Ethics**: responsibility is visible; no deliberate obscurity.
