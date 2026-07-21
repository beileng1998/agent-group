// FILE: terminalPaneTabsAndSizing.ts
// Purpose: Owns terminal tabs, split sizing, equalization, and group creation mutations.
// Layer: Web terminal domain helpers

import { type ThreadTerminalGroup, type ThreadTerminalLayoutNode } from "../types";

function updateLeafNode(
  node: ThreadTerminalLayoutNode,
  terminalId: string,
  updater: (
    node: Extract<ThreadTerminalLayoutNode, { type: "terminal" }>,
  ) => ThreadTerminalLayoutNode,
): { node: ThreadTerminalLayoutNode; updated: boolean } {
  if (node.type === "terminal") {
    if (!node.terminalIds.includes(terminalId)) return { node, updated: false };
    return { node: updater(node), updated: true };
  }
  let updated = false;
  const nextChildren = node.children.map((child) => {
    const result = updateLeafNode(child, terminalId, updater);
    if (result.updated) updated = true;
    return result.node;
  });
  return updated ? { node: { ...node, children: nextChildren }, updated } : { node, updated };
}

export function addTerminalTabToGroupLayout(
  group: ThreadTerminalGroup,
  targetTerminalId: string,
  newTerminalId: string,
): ThreadTerminalGroup {
  const result = updateLeafNode(group.layout, targetTerminalId, (node) => ({
    ...node,
    terminalIds: [...node.terminalIds, newTerminalId],
    activeTerminalId: newTerminalId,
  }));
  if (!result.updated) return group;
  return { ...group, activeTerminalId: newTerminalId, layout: result.node };
}

export function setActiveTerminalInGroupLayout(
  group: ThreadTerminalGroup,
  terminalId: string,
): ThreadTerminalGroup {
  const result = updateLeafNode(group.layout, terminalId, (node) =>
    node.activeTerminalId === terminalId ? node : { ...node, activeTerminalId: terminalId },
  );
  if (!result.updated) return group;
  return group.activeTerminalId === terminalId && result.node === group.layout
    ? group
    : { ...group, activeTerminalId: terminalId, layout: result.node };
}

function normalizedWeight(weight: number | undefined): number {
  return Number.isFinite(weight) && weight && weight > 0 ? weight : 1;
}

function normalizeSplitWeights(childrenCount: number, weights: number[] | undefined): number[] {
  const nextWeights = Array.from({ length: childrenCount }, (_, index) =>
    normalizedWeight(weights?.[index]),
  );
  return nextWeights.length > 0 ? nextWeights : [1];
}

function resizeSplitNode(
  node: ThreadTerminalLayoutNode,
  splitId: string,
  weights: number[],
): { node: ThreadTerminalLayoutNode; didResize: boolean } {
  if (node.type === "terminal") return { node, didResize: false };
  if (node.id === splitId) {
    return {
      node: { ...node, weights: normalizeSplitWeights(node.children.length, weights) },
      didResize: true,
    };
  }
  let didResize = false;
  const nextChildren = node.children.map((child) => {
    const result = resizeSplitNode(child, splitId, weights);
    if (result.didResize) didResize = true;
    return result.node;
  });
  return didResize ? { node: { ...node, children: nextChildren }, didResize } : { node, didResize };
}

export function resizeTerminalGroupLayout(
  group: ThreadTerminalGroup,
  splitId: string,
  weights: number[],
): ThreadTerminalGroup {
  const result = resizeSplitNode(group.layout, splitId, weights);
  return result.didResize ? { ...group, layout: result.node } : group;
}

function equalizeLayoutNode(node: ThreadTerminalLayoutNode): ThreadTerminalLayoutNode {
  if (node.type === "terminal") return node;
  return {
    ...node,
    children: node.children.map(equalizeLayoutNode),
    weights: node.children.map(() => 1),
  };
}

export function equalizeTerminalGroupLayout(group: ThreadTerminalGroup): ThreadTerminalGroup {
  return { ...group, layout: equalizeLayoutNode(group.layout) };
}

export function createTerminalGroup(groupId: string, terminalId: string): ThreadTerminalGroup {
  return {
    id: groupId,
    activeTerminalId: terminalId,
    layout: {
      type: "terminal",
      paneId: `pane-${terminalId}`,
      terminalIds: [terminalId],
      activeTerminalId: terminalId,
    },
  };
}
