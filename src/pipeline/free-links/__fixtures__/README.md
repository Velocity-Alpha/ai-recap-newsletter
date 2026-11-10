# Free-link test set (#59)

Recorded answers of the OpenAI web search for 10 published stories whose link was flagged paywalled.
Recorded on 2026-11-10. Public news links only. Tests use this file and call no outside service.

`search-answers.json` is a list. One entry:

| Field | Meaning |
|---|---|
| `story` | `id`, `headline`, `summary`, `url` (the link at the time), `published_on`. |
| `answer` | The model's answer text, as the code must parse it: `{"links":[{"url","title","site"}]}`. |
| `reads` | For each returned link, the word count the article reader got. `0` means the page could not be read. |
| `searches`, `input_tokens` | What the request used. |

Stories 10844, 10916, and 11042 are three of the four links the owner replaced by hand in the archive.
The request that produced these answers is in issue #59 and must stay equal to the one in the code.
