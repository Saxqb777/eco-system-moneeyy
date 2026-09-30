// House rule 7: no em dashes and no dashes as punctuation in anything the agents write for people.
// Hyphens inside words, numbers, links and addresses stay (model numbers, dates, URLs); the prompts ask for none.
export function plainDashes(input: string): string {
  return input
    .replace(/(\d)[ \t]*[–—][ \t]*(\d)/g, "$1 to $2") // 10–20 becomes 10 to 20
    .replace(/^([ \t]*)[-–—][ \t]+/gm, "$1• ") // list lines start with a bullet, not a dash
    .replace(/[ \t]*[—–][ \t]*$/gm, "") // a dash hanging at the end of a line goes
    .replace(/[ \t]*[—–][ \t]*/g, ", ") // any other em or en dash becomes a comma pause
    .replace(/[ \t]+-{1,2}[ \t]+/g, ", ") // a spaced hyphen used as a dash
    .replace(/,[ \t]*,/g, ",");
}
