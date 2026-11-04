import "server-only";
import { cookies } from "next/headers";
import { PARAMS_COOKIE, parseParamsCookie } from "./params";

/** Scenario parameters applied by the user (cookie), or the defaults. */
export async function currentParams() {
  const jar = await cookies();
  return parseParamsCookie(jar.get(PARAMS_COOKIE)?.value);
}
