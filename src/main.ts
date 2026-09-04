import { addChild, createNode } from "./model";
import { startApp } from "./app";

function buildSampleTree() {
  const root = createNode("Mindmapper");

  const creativity = addChild(root, "Creativity");
  addChild(creativity, "Quick start");
  addChild(creativity, "Capture inspiration");
  addChild(creativity, "Reshape the structure");

  const organize = addChild(root, "Organize ideas");
  addChild(organize, "Sorting order");
  addChild(organize, "Check for omissions");
  addChild(organize, "Structured");

  const efficient = addChild(root, "Efficient");
  addChild(efficient, "Easy to operate");
  addChild(efficient, "Intuitive interface");

  const tools = addChild(root, "Powerful tools");
  addChild(tools, "Exquisite theme");
  addChild(tools, "Free export");
  addChild(tools, "Custom settings");

  return root;
}

window.addEventListener("DOMContentLoaded", () => {
  const app = document.querySelector<HTMLDivElement>("#app")!;
  startApp(app, buildSampleTree());
});
