import { redirect } from "next/navigation";

// The overview was merged into the Management workspace.
export default function Overview() {
  redirect("/workspace/management");
}
