import { PageHeader } from "@/components/ui";
import { downtimeProbabilities, frontier, getImpact, portfolio } from "@/lib/data";
import { DEFAULT_PARAMS } from "@/lib/params";
import { replay } from "@/lib/replay";
import { currentParams } from "@/lib/server-params";
import { ScenarioClient } from "./ScenarioClient";

export const dynamic = "force-dynamic";

export default async function ScenarioPage() {
  const params = await currentParams();
  const impact = getImpact();
  return (
    <>
      <PageHeader
        crumbs={[{ label: "Analytics" }, { label: "Cost–Risk Scenarios" }]}
        title="Cost–Risk Optimization Scenarios"
        subtitle="Simulate raising or lowering inventory levels and see the trade-off between working capital, holding cost and downtime risk. Apply a scenario to drive every recommendation in the app."
      />
      <ScenarioClient
        initialParams={params}
        defaults={DEFAULT_PARAMS}
        initial={{ portfolio: portfolio(params), frontier: frontier(params), replay: (({ staticPolicy, aiPolicy }) => ({ staticPolicy, aiPolicy }))(replay(params)) }}
        downtimeProb={downtimeProbabilities()}
        emergenciesPerYear={impact.emergenciesPerYear}
      />
    </>
  );
}
