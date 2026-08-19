---
"@glrs-dev/glrs": patch
---

The first extension to claim a tool name keeps it, and a tool filter no longer depends on load order.

Two bugs in the same seam, both of which made what the model can call depend on the order extensions happened to load in.

**A tool filter held names, not predicates.** `g.filterTools` resolved its predicate to a list of tool names once, at the moment it was registered. A tool belonging to an extension that had not loaded yet was simply absent from that list, so it stayed withheld for the rest of the session however permissive the filter itself was — a read-only extension that loaded early would withhold a tool it had never been asked about. The predicates are kept now and applied per model call, so a tool that arrives later is judged by the filter rather than missed by it.

**Tool names were last-writer-wins.** Every other namespace in glorious is first-wins — commands, user commands, skills, the activity row — and the table in the extension docs states it as a general rule. Tool names were the exception, and the exception ran backwards: because extensions load project-first, the later an extension loaded the more it could take, so the ones glorious ships would have beaten a project's own. Registering `bash` in `.glorious/extensions/` now replaces the shipped one, and you do not have to shadow a whole extension to replace one of its tools.

A registration that loses is reported rather than dropped in silence. `/extensions` lists it as `shadowed: bash` under the extension that tried, because that listing is the only account anyone gets of what a loaded extension did and claiming a tool it does not own would make the account wrong.

Neither bug was visible to the type checker and neither had a test. Both do now, and both tests fail against the previous behaviour.
