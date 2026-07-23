// Per-rep AI focus insights — "what to work today, and how MASE can help."
//
// FOR NOW this is a curated, AI-authored insight keyed by rep name (starting with Karson
// Keogh) so we can show reps how the AI reads their whole book and hands them a plan. The
// prose is grounded in each rep's REAL deals; the frontend resolves every `account` to the
// live deal record, so the numbers (amount, close date, win/momentum) and the click-through
// stay live — only the narrative + the "how I can help" seed prompts are authored here.
//
// PRODUCTION PATH: replace this map with a fetch from a `rep_focus` table populated nightly
// by a backend LLM job (owner → insight jsonb). The frontend shape below is what that job
// should emit, so swapping the source is a one-line change in DealInsights.

export interface RepFocusItem {
  account: string;   // match key against the live deal's account_name (normalised, prefix match)
  headline: string;  // the one-line "why this deal, now"
  why: string;       // 1–2 sentences of reasoning from the deal's signals
  doNow: string;     // the concrete next move
  aiHelp: string;    // button label — the help MASE offers
  seed: string;      // the prompt MASE opens pre-loaded with when the rep clicks
}

export interface RepInsight {
  headline: string;
  summary: string;
  focus: RepFocusItem[];
  watch?: string;
}

export const repInsights: Record<string, RepInsight> = {
  "Karson Keogh": {
    headline: "Two deals can close this week — here's your play.",
    summary:
      "$636K is sitting in the next 7 days across Consumer Cellular and Bass Pro, and your biggest winnable — Sabic at $518K — is stuck behind one overdue demo. Three moves today move all three.",
    focus: [
      {
        account: "Consumer Cellular",
        headline: "Closest to the line — and you're the front-runner",
        why: "Win 79, momentum 69, closes in 8 days. Your champion has named Zycus the front-runner and the competition has gone quiet. Only the legal backlog and the Z Pay / TransferMate payments question stand between you and signature.",
        doNow: "Send the confirmed payments answer to AP today, and push Joseph Reiber to unblock the MSA review before the 31st.",
        aiHelp: "Draft the payments email + legal nudge",
        seed: "Draft the Z Pay / TransferMate payments-workflow answer email to Consumer Cellular's AP lead — cover international and early-pay-discount terms — plus a short, firm nudge to Joseph Reiber in legal to unblock the MSA / Order Form review before the 31 Jul close.",
      },
      {
        account: "Bass Pro",
        headline: "$445K closing in 7 days — but it's a real fight",
        why: "Closes in 7 days at $445K, but win is only 38 — Coupa is in with a counter-offer. Winnable if you move fast on price defense.",
        doNow: "Get a firm delivery date on Coupa's counter from David Elford and reconfirm your displacement-pricing position.",
        aiHelp: "Prep the displacement-pricing case",
        seed: "Help me defend Bass Pro against Coupa's counter-offer: draft a displacement-pricing one-pager and talking points, plus a short note to David Elford asking for a firm delivery date on Coupa's counter.",
      },
      {
        account: "Sabic Innovative Plastics",
        headline: "Your biggest winnable — unblock it",
        why: "$518K, win 56, momentum 68 — strong, but waiting on an overdue SAP integration demo you promised. Ship that and lock the technical session and this accelerates.",
        doNow: "Send the SAP integration demo video + EDI/goods-receipt write-up, and lock the 30-minute technical session.",
        aiHelp: "Draft the demo follow-up + book the session",
        seed: "Draft the Sabic Innovative Plastics follow-up: send over the SAP integration demo video and the EDI / goods-receipt write-up, and propose three times for the promised 30-minute technical session.",
      },
      {
        account: "Cadence Design Systems",
        headline: "Momentum stalled — go around the blocker",
        why: "Win 48 but momentum just 11 — the Hughes channel has gone dark. $210K, closes in ~3 weeks; it slips if you wait.",
        doNow: "Reach Jason Lieu or Devesh Chadha directly to confirm Zycus is still in the running.",
        aiHelp: "Draft the re-engagement note",
        seed: "Draft a re-engagement note to Jason Lieu and Devesh Chadha at Cadence Design Systems to confirm Zycus is still in the running — the Hughes channel has gone quiet and the deal is stalling.",
      },
    ],
    watch:
      "Allstate is your biggest deal at $1.5M, but it's cold — win 36, momentum 10, off track. It needs a reset, not today's energy.",
  },

  "Casper Hoeholt": {
    headline: "No deals closing this week — so today is about momentum, not paperwork.",
    summary:
      "Your book is mid-funnel and single-threaded: every top deal rests on one contact. The wins here come from widening relationships and locking the next concrete step before the summer stalls them.",
    focus: [
      {
        account: "IAG GBS",
        headline: "Your strongest position — don't let it drift",
        why: "Win 46, momentum 42 — your best-positioned deal, but it hangs on Kelly, who has already slipped an internal date once. Formal Evaluation with no firm next step is how these go quiet.",
        doNow: "Lock a firm date/time with Kelly for the BA functionality presentation before the OpCo review window narrows further.",
        aiHelp: "Draft the note to Kelly",
        seed: "Draft a short, friendly but firm note to Kelly at IAG GBS locking a specific date and time for the BA functionality presentation, before the OpCo review window closes further.",
      },
      {
        account: "Anora Group",
        headline: "Biggest deal, one thread — widen it now",
        why: "$400K, but everything runs through Ari Alm — the VP of Sourcing, finance director and CIO aren't even on the opportunity. Single-threaded deals this size are fragile.",
        doNow: "Add the VP of Sourcing, finance director and CIO as formal Opportunity Contact Roles and get an introduction to at least one.",
        aiHelp: "Draft the multi-thread intro ask",
        seed: "Help me multi-thread the Anora Group deal: draft a note to Ari Alm requesting introductions to the VP of Sourcing, the finance director and the CIO so they can be added as stakeholders.",
      },
      {
        account: "ASSA ABLOY",
        headline: "Arm your champion for her August review",
        why: "Anna's budget approval is gated on an internal conversation she hasn't had yet — she needs ammunition to make the case.",
        doNow: "Send Anna the promised comparable-industry reference stories to strengthen her business case ahead of her August review.",
        aiHelp: "Pull the references + draft the email",
        seed: "Draft an email to Anna at ASSA ABLOY sending the comparable-industry reference stories she was promised, framed to strengthen her business case for her August budget review.",
      },
      {
        account: "Olvi",
        headline: "Confirm the business case is actually moving",
        why: "The economic buyer has never engaged Zycus directly, and the champion is validating numbers with no committed submission date. Silence here reads as slippage.",
        doNow: "Call Suvi Lehtonen to confirm she's validating the 14 Jul business-case numbers and lock a firm internal-submission date.",
        aiHelp: "Draft the check-in to Suvi",
        seed: "Draft a check-in to Suvi Lehtonen at Olvi confirming she is validating the 14 Jul business-case numbers and asking her to commit to a firm internal-submission date.",
      },
    ],
    watch:
      "Metroselskabet is a wide market dialogue against ~8 vendors (Coupa and Kodiak Hub named), win 16 — pursue it only with an exec-sponsored value workshop, not a standard chase.",
  },

  "Justin Ajmo": {
    headline: "One thing is due today — start there, then unstick two stalls.",
    summary:
      "Bessemer's RFP answers are due today and it's your best-positioned deal. After that, the pattern is clear across your book: strong interest, but missing economic buyers and pricing conversations — that's what's stalling Roivant, Teneo and Tufts.",
    focus: [
      {
        account: "Bessemer Trust",
        headline: "Due today — and it's your strongest",
        why: "Win 45, momentum 50. The RFP clarifications you committed to on the 16 Jul demo are due today, and no real economic buyer has engaged yet — only a title-match attended.",
        doNow: "Submit the outstanding RFP clarification answers today, and line up a real economic-buyer touch (CFO/COO).",
        aiHelp: "Draft the RFP clarification response",
        seed: "Help me finish the Bessemer Trust RFP: draft the outstanding clarification answers committed to on the 16 Jul demo, and a note proposing a short executive (CFO/COO) alignment call.",
      },
      {
        account: "Roivant Sciences",
        headline: "No pricing talk since March — change that",
        why: "Shortlisted and closing in ~5 weeks, yet there has been no commercial or pricing conversation since the RFP arrived in March. You can't close what you haven't priced.",
        doNow: "Get a firm IT knowledge-transfer completion date from Jason, meet the new IT lead, and open the pricing conversation.",
        aiHelp: "Draft the pricing + timeline note",
        seed: "Draft a note to Jason at Roivant Sciences asking for a firm IT leadership knowledge-transfer completion date, requesting an intro to the new IT lead, and proposing to start the commercial/pricing conversation.",
      },
      {
        account: "Teneo",
        headline: "Highest momentum — convert it on today's call",
        why: "Momentum 51 and a discovery call today, but no economic buyer identified — only the Procurement Director is in scope. Today is the moment to surface real pain and authority.",
        doNow: "Run today's discovery call and drill into the PO-process and contract-repository priorities to surface concrete pain and the economic buyer.",
        aiHelp: "Prep the discovery-call plan",
        seed: "Prep me for today's Teneo discovery call: a focused plan to drill into their PO-process and contract-repository priorities, surface quantified pain, and identify the economic buyer.",
      },
      {
        account: "Tufts University",
        headline: "Six months stalled — a POC breaks the logjam",
        why: "Stalled ~6 months and flagged unhealthy in Salesforce. A concrete POC gives CPO Nisreen Bagasrawala a reason to move.",
        doNow: "Scope and propose the POC/sandbox — cost, timeline, PeopleSoft/Unimarket integration points — directly to CPO Nisreen Bagasrawala.",
        aiHelp: "Draft the POC proposal outline",
        seed: "Draft a POC/sandbox proposal outline for Tufts University addressed to CPO Nisreen Bagasrawala, covering cost, timeline and the PeopleSoft/Unimarket integration points.",
      },
    ],
    watch:
      "Cornell is your biggest at $450K but momentum is 9 — parked, not lost. And Stemline has sat in Formal Evaluation ~10 months. Both need a reset, not today's hours.",
  },

  "Grace Kim": {
    headline: "IDB can close this week — finish the reference call and lock it.",
    summary:
      "IDB Invest is 8 days out and only the reference call stands in the way. Beyond it, your book is full of real interest with slipping timelines — and the fix is the same each time: pin a firm next date.",
    focus: [
      {
        account: "IDB Invest",
        headline: "Closing in 8 days — clear the last blocker",
        why: "Win 38, momentum 50, closes in 8 days. The SM Retail reference call (which replaced GPI) is the last thing in the way — but the deal was also cut from $185K to $100K at MSA time with no stated reason.",
        doNow: "Coordinate and complete the SM Retail reference call, and get clarity on why the amount was cut before signature.",
        aiHelp: "Draft the reference-call coordination",
        seed: "Draft the coordination note to set up the SM Retail reference call for IDB Invest, and help me raise — tactfully — why the deal amount was cut from $185K to $100K at MSA finalization.",
      },
      {
        account: "Greater Orlando Aviation",
        headline: "Highest momentum in your book — feed it",
        why: "Momentum 57, the strongest in your book — but no economic buyer has been on a call and analyst reports you promised on 16 Jun are overdue.",
        doNow: "Send the overdue Gartner/Forrester analyst reports, and push to get one of the four finance/exec titles onto a call.",
        aiHelp: "Draft the analyst-report follow-up",
        seed: "Draft the follow-up to Greater Orlando Aviation Authority sending the overdue Gartner/Forrester analyst reports promised on 16 Jun, and proposing a short call with a finance/exec sponsor.",
      },
      {
        account: "Pep Promotions",
        headline: "Five months quiet — force a firm date",
        why: "Win 42 but momentum 20 — there's been a five-month gap since the last live contact, and the VP of Sourcing Operations hasn't engaged.",
        doNow: "Lock Christina Behm's tentative week-of-20-Jul connect into a firm on-site or POC date.",
        aiHelp: "Draft the note to lock the date",
        seed: "Draft a note to Christina Behm at Pep Promotions turning her tentative week-of-20-Jul 'connect' into a firm on-site or POC date, and gently pulling the VP of Sourcing Operations back in.",
      },
      {
        account: "DuBois Chemicals",
        headline: "Timeline's slipped four times — get it in writing",
        why: "The decision date has slipped at least four times and three recent calls haven't connected. A written, specific ask is what breaks that cycle.",
        doNow: "Send Tharun a written check-in asking for a specific internal-approval date.",
        aiHelp: "Draft the check-in to Tharun",
        seed: "Draft a concise written check-in to Tharun at DuBois Chemicals asking for a specific internal-approval date, given the decision timeline has slipped several times.",
      },
    ],
    watch:
      "Watchtower is your biggest at $280K but momentum is 8 — it's parked. Don't spend today's energy there.",
  },

  "Claire Hudson": {
    headline: "$489K can close this week across two strong deals — protect both.",
    summary:
      "Global Switch and Bright Horizons are both 7–8 days out with win in the 80s — the best pair in your book. Each has one logistical blocker to clear this week. Don't let paperwork or a reference call slip them.",
    focus: [
      {
        account: "Global Switch",
        headline: "Your strongest — but the dates don't line up",
        why: "Win 80, momentum 90, closes in 7 days — but the recorded close date (30 Jul) sits BEFORE the CEO demo (31 Jul). That has to be fixed or the close date is fiction.",
        doNow: "Get written confirmation of the 31 Jul CEO demo and Gavin Greer 1-2-1 from Martin Loveday, and reset the close date to reality.",
        aiHelp: "Draft the confirmation + date reset",
        seed: "Draft a note to Martin Loveday at Global Switch getting written confirmation of the 31 Jul CEO demo and the Gavin Greer 1-2-1, and help me reset the Salesforce close date so it sits after the CEO demo.",
      },
      {
        account: "Bright Horizons",
        headline: "$251K in 8 days — clear the reference call",
        why: "Win 80, momentum 78, closes in 8 days — but an unscheduled reference call and MSA/SOW redlines still sit against that date.",
        doNow: "Confirm the reference-call date, company and contact with Elaine Rymill so Daniel Schmitz can schedule the session, and stay on the redlines.",
        aiHelp: "Draft the reference-call confirmation",
        seed: "Draft a note to Elaine Rymill at Bright Horizons confirming the reference-call date, company and contact so Daniel Schmitz can schedule the Teams session, and a nudge to keep the MSA/SOW redlines moving.",
      },
      {
        account: "E&Y_UK",
        headline: "A go/no-go is coming — be first to respond",
        why: "Win 52, momentum 57, and CPO Kathy's go/no-go review is imminent — but an internal SAP-program stakeholder reacted negatively on hearing Zycus was in.",
        doNow: "Follow up within 24–48h of Kathy's review to learn the outcome and act on it immediately, and get ahead of the SAP-program objection.",
        aiHelp: "Draft the go/no-go follow-up",
        seed: "Draft a follow-up to Kathy (CPO) at EY UK to be sent within 24–48h of her go/no-go review, and help me prepare a response to the internal SAP-program stakeholder who reacted negatively to Zycus.",
      },
      {
        account: "Pladis Global",
        headline: "$350K waiting on ROI + Capex",
        why: "Win 57, momentum 52 — the biggest of your mid-funnel deals, gated on an ROI review and internal Capex approval.",
        doNow: "Lock the ROI-review call referenced in the Next Step and confirm Alessandro's registration for the 23 Jul CIPS webinar.",
        aiHelp: "Draft the ROI-review scheduling",
        seed: "Draft a note to lock the ROI-review call for Pladis Global and confirm Alessandro's registration for the 23 Jul CIPS webinar, framed to help move their internal Capex approval.",
      },
    ],
    watch:
      "The Government of Scotland is your whale at $2M, but win 22 / momentum 5 — early and cold. Nurture it, don't bank on it.",
  },
};

// Normalise an account name for matching ("Bass Pro, LLC" ~ "Bass Pro"): lowercase, drop
// common suffixes/punctuation so the curated key finds the live record.
export function normAccount(s: string | null | undefined): string {
  return String(s || "")
    .toLowerCase()
    .replace(/,?\s*(inc|llc|ltd|s\.a\.b\.?\s*de\s*c\.v\.|s\.a\.|corp|co|company|group|the)\.?$/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}
