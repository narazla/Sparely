export type RoleId = "planner" | "maintenance" | "procurement" | "management";

export interface Role {
  id: RoleId;
  name: string;
  who: string;
  question: string;
  steps: string[];
  receives: string;
  hands_off: string;
}

/** The four people who use the system and the hand-offs between them. */
export const ROLES: Role[] = [
  {
    id: "maintenance",
    name: "Maintenance & Reliability",
    who: "Maintenance planner / reliability engineer",
    question: "Will the parts for my planned jobs be there, and which critical parts are unprotected?",
    steps: [
      "Check part readiness of every overhaul, replacement and lubrication job due in the next 90 days",
      "Request the parts that are short",
      "Check part readiness for the next turnaround (scope of the last one, date set by the planner)",
      "Act on ML early warnings: parts likely to be needed soon with no stock and no PO",
      "Decide which never-used critical parts to keep as insurance spares",
    ],
    receives: "Maintenance plan, failure history, demand forecast",
    hands_off: "Part requests → Procurement",
  },
  {
    id: "planner",
    name: "Inventory Planner",
    who: "Inventory / MRP controller",
    question: "What do I reorder today, how much, and which Min–Max settings are wrong?",
    steps: [
      "Use stock of the same item held under another material number before buying",
      "Approve or adjust the recommended reorder list (priority = stockout risk × criticality)",
      "Approve dynamic Min–Max updates for the ERP",
      "Approve reductions of excess and non-moving stock",
    ],
    receives: "Recommendations, scenario policy from Management",
    hands_off: "Approved reorders → Procurement; capital released → Management",
  },
  {
    id: "procurement",
    name: "Procurement",
    who: "Buyer / purchasing group",
    question: "What must I buy, from whom, by when — and which open POs must I chase?",
    steps: [
      "Turn approved reorders and job requests into a PR draft (supplier, PR type, purchasing group from history)",
      "Expedite open POs that are the only cover against a stockout",
    ],
    receives: "Approved buys from Planner and Maintenance",
    hands_off: "PR draft → ERP; spend committed → Management",
  },
  {
    id: "management",
    name: "Management",
    who: "Plant / supply-chain manager, finance",
    question: "How much capital is tied up, how much risk do we carry, and what are the decisions worth?",
    steps: [
      "Track committed spend, capital released and downtime risk removed by the team's decisions",
      "See the proof: May–Sep 2026 replayed under today's Min–Max and the Sparely policy",
      "Set the cost–risk policy (scenario) that every workspace then uses",
    ],
    receives: "Decisions from every workspace",
    hands_off: "Cost–risk policy → all workspaces",
  },
];

export const roleById = (id: string) => ROLES.find((r) => r.id === id);
