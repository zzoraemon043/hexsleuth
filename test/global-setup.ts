import { resolve } from "node:path";
import { generateFixtures } from "../scripts/fixtures/index.js";

export default function setup(): void {
  generateFixtures(resolve("fixtures"));
}
