import { addChild, createNode, type MindMapNode } from "./model";

export interface Template {
  name: string;
  build(): MindMapNode;
}

function projectPlan(): MindMapNode {
  const root = createNode("Project Plan");
  const goals = addChild(root, "Goals");
  addChild(goals, "Define success metrics");
  addChild(goals, "Identify stakeholders");
  const milestones = addChild(root, "Milestones");
  addChild(milestones, "Kickoff");
  addChild(milestones, "MVP");
  addChild(milestones, "Launch");
  const risks = addChild(root, "Risks");
  addChild(risks, "Budget");
  addChild(risks, "Timeline");
  return root;
}

function retro(): MindMapNode {
  const root = createNode("Retro");
  addChild(addChild(root, "What went well"), "...");
  addChild(addChild(root, "What could improve"), "...");
  addChild(addChild(root, "Action items"), "...");
  return root;
}

function weeklyTodo(): MindMapNode {
  const root = createNode("This Week");
  const work = addChild(root, "Work");
  addChild(work, "Task 1");
  addChild(work, "Task 2");
  const personal = addChild(root, "Personal");
  addChild(personal, "Task 1");
  addChild(root, "Errands");
  return root;
}

// Starter trees for the tab strip's "+" button — small, illustrative
// starting points for the user to edit, not finished documents.
export const TEMPLATES: Template[] = [
  { name: "Blank", build: () => createNode("Untitled") },
  { name: "Project Plan", build: projectPlan },
  { name: "Retro", build: retro },
  { name: "Weekly To-do", build: weeklyTodo },
];
