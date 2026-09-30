// Everything the people in the building say, and the words on the LED sign. Pure, so tests can check that no
// dash ever reaches the screen (rule 7).

// Everything people say is short and plain, with no dashes.
export const LINES = {
  warden: ["How is it going?", "Good work", "Keep them coming", "Numbers look good", "Any blockers?", "Nice draft", "Ship it", "Proud of this team"],
  crew: ["On it", "Almost there", "All good", "Two more today", "Thanks boss", "Nearly done", "Looking good"],
  wardenCapped: ["Budget is done for today", "Rest up, big day tomorrow", "Cap reached, good effort"],
  crewCapped: ["Feet up till midnight", "Back at it tomorrow", "Recharging"],
  errand: ["For you", "Fresh leads", "Signed copy", "The numbers", "Your draft"],
  thanks: ["Thanks", "Perfect", "Got it", "Cheers"],
  guest: ["Here for a demo", "Delivery for DocLedger", "Meeting at three", "Is Saaqib in?", "Invoice pickup"],
  reception: ["Welcome, lift on the left", "Please go on up", "They are expecting you"],
  board: ["Leads first", "Partners next", "Test new subject lines", "Demo before price", "Follow up faster", "One more market"],
  boardReply: ["Agreed", "I can take that", "Let us try it", "Good call"],
  runStart: "Everyone, to work!",
};

// Dashes never reach the sign: a hyphen between words or a long dash becomes a comma.
export function newsText(lines: string[]): string {
  return lines
    .map((l) => l.replace(/\s*[\u2014\u2013]\s*/g, ", ").replace(/\s+-\s+/g, ", ").trim())
    .filter(Boolean)
    .map((l) => l.toUpperCase())
    .join("   \u2022   ");
}

