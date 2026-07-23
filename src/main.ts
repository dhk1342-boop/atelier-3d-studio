import "./style.css";
import { InteriorStudio } from "./planner";

const root = document.querySelector<HTMLDivElement>("#app");

if (!root) {
  throw new Error("App root not found.");
}

new InteriorStudio(root);
