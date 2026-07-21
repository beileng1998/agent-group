// FILE: storeProjectProjection.ts
// Purpose: Normalize and upsert project rows while preserving stable references and local UI state.
// Layer: Web state project projection

import type { Project } from "../types";
import { arraysShallowEqual, deepEqualJson, normalizeModelSelection } from "./storeEquality";
import {
  basenameOfPath,
  persistedExpandedProjectCwds,
  persistedProjectNamesByCwd,
  persistedProjectOrderCwds,
  projectCwdKey,
} from "./storePersistence";
import type { AppState, ReadModelProject, ShellSnapshotProject } from "./storeState";

function normalizeProjectScripts(
  incoming: ReadModelProject["scripts"],
  previous: Project["scripts"] | undefined,
): Project["scripts"] {
  const nextScripts = incoming.map((script, index) => {
    const existing = previous?.[index];
    return existing && deepEqualJson(existing, script) ? existing : script;
  });
  return arraysShallowEqual(previous, nextScripts) ? previous : nextScripts;
}

export function normalizeProjectFromReadModel(
  incoming: ReadModelProject,
  previous: Project | undefined,
): Project {
  return normalizeProject(incoming, previous);
}

export function normalizeProjectFromShell(
  incoming: ShellSnapshotProject,
  previous: Project | undefined,
): Project {
  return normalizeProject(incoming, previous);
}

function normalizeProject(
  incoming: ReadModelProject | ShellSnapshotProject,
  previous: Project | undefined,
): Project {
  const workspaceRootKey = projectCwdKey(incoming.workspaceRoot);
  const folderName = basenameOfPath(incoming.workspaceRoot) ?? incoming.title;
  const localName = previous?.localName ?? persistedProjectNamesByCwd.get(workspaceRootKey) ?? null;
  const defaultModelSelection =
    incoming.defaultModelSelection === null
      ? null
      : normalizeModelSelection(incoming.defaultModelSelection, previous?.defaultModelSelection);
  const scripts = normalizeProjectScripts(incoming.scripts, previous?.scripts);
  const expanded =
    previous?.expanded ??
    (persistedExpandedProjectCwds.size > 0
      ? persistedExpandedProjectCwds.has(workspaceRootKey)
      : true);

  if (
    previous &&
    previous.id === incoming.id &&
    previous.kind === incoming.kind &&
    previous.name === (localName ?? incoming.title) &&
    previous.remoteName === incoming.title &&
    previous.folderName === folderName &&
    previous.localName === localName &&
    previous.cwd === incoming.workspaceRoot &&
    previous.defaultModelSelection === defaultModelSelection &&
    previous.expanded === expanded &&
    (previous.isPinned ?? false) === (incoming.isPinned ?? false) &&
    previous.createdAt === incoming.createdAt &&
    previous.updatedAt === incoming.updatedAt &&
    previous.scripts === scripts
  ) {
    return previous;
  }
  return {
    id: incoming.id,
    kind: incoming.kind ?? "project",
    name: localName ?? incoming.title,
    remoteName: incoming.title,
    folderName,
    localName,
    cwd: incoming.workspaceRoot,
    defaultModelSelection,
    expanded,
    isPinned: incoming.isPinned ?? false,
    createdAt: incoming.createdAt,
    updatedAt: incoming.updatedAt,
    scripts,
  } satisfies Project;
}

export function upsertProjectFromReadModel(state: AppState, incoming: ReadModelProject): AppState {
  if (state.deletedProjectIdsById?.[incoming.id] === true) return state;
  const existingProject = state.projects.find((project) => project.id === incoming.id);
  const nextProject = normalizeProjectFromReadModel(incoming, existingProject);
  if (existingProject) {
    if (existingProject === nextProject) return state;
    return {
      ...state,
      projects: state.projects.map((project) =>
        project.id === incoming.id ? nextProject : project,
      ),
    };
  }
  return { ...state, projects: [...state.projects, nextProject] };
}

export function upsertProjectFromShell(state: AppState, incoming: ShellSnapshotProject): AppState {
  if (state.deletedProjectIdsById?.[incoming.id] === true) return state;
  const existingProject =
    state.projects.find((project) => project.id === incoming.id) ??
    state.projects.find(
      (project) => projectCwdKey(project.cwd) === projectCwdKey(incoming.workspaceRoot),
    );
  const nextProject = normalizeProjectFromShell(incoming, existingProject);
  if (existingProject) {
    if (existingProject === nextProject) return state;
    return {
      ...state,
      projects: state.projects.map((project) =>
        project.id === existingProject.id ? nextProject : project,
      ),
    };
  }
  return { ...state, projects: [...state.projects, nextProject] };
}

function mapProjects<TIncoming extends ReadModelProject | ShellSnapshotProject>(
  incoming: readonly TIncoming[],
  previous: Project[],
  normalize: (project: TIncoming, existing: Project | undefined) => Project,
): Project[] {
  const previousById = new Map(previous.map((project) => [project.id, project] as const));
  const previousByCwd = new Map(
    previous.map((project) => [projectCwdKey(project.cwd), project] as const),
  );
  const previousOrderById = new Map(previous.map((project, index) => [project.id, index] as const));
  const previousOrderByCwd = new Map(
    previous.map((project, index) => [projectCwdKey(project.cwd), index] as const),
  );
  const persistedOrderByCwd = new Map(
    persistedProjectOrderCwds.map((cwd, index) => [cwd, index] as const),
  );
  const usePersistedOrder = previous.length === 0;
  const mappedProjects = incoming
    .map((project) => {
      const existing =
        previousById.get(project.id) ?? previousByCwd.get(projectCwdKey(project.workspaceRoot));
      return normalize(project, existing);
    })
    .map((project, incomingIndex) => {
      const previousIndex =
        previousOrderById.get(project.id) ?? previousOrderByCwd.get(projectCwdKey(project.cwd));
      const persistedIndex = usePersistedOrder
        ? persistedOrderByCwd.get(projectCwdKey(project.cwd))
        : undefined;
      const orderIndex =
        previousIndex ??
        persistedIndex ??
        (usePersistedOrder ? persistedProjectOrderCwds.length : previous.length) + incomingIndex;
      return { project, incomingIndex, orderIndex };
    })
    .toSorted((left, right) =>
      left.orderIndex === right.orderIndex
        ? left.incomingIndex - right.incomingIndex
        : left.orderIndex - right.orderIndex,
    )
    .map((entry) => entry.project);
  return arraysShallowEqual(previous, mappedProjects) ? previous : mappedProjects;
}

export function mapProjectsFromReadModel(
  incoming: readonly ReadModelProject[],
  previous: Project[],
): Project[] {
  return mapProjects(incoming, previous, normalizeProjectFromReadModel);
}

export function mapProjectsFromShellSnapshot(
  incoming: readonly ShellSnapshotProject[],
  previous: Project[],
): Project[] {
  return mapProjects(incoming, previous, normalizeProjectFromShell);
}
