import { createStorage, StorageEnum } from '../base/index.js';
import type { Project, ProjectCreateInput, ProjectUpdatePayload } from '@extension/types';

interface ProjectsStorageState {
  projects: Project[];
}

const storage = createStorage<ProjectsStorageState>(
  'projects-storage-key',
  {
    projects: [],
  },
  {
    storageEnum: StorageEnum.Local,
    liveUpdate: true,
  },
);

export const projectsStorage = {
  ...storage,
  addProject: async (input: ProjectCreateInput) => {
    const newProject: Project = {
      ...input,
      id: Date.now().toString(),
      createdAt: Date.now(),
      lastModified: Date.now(),
    };

    await storage.set(currentState => ({
      ...currentState,
      projects: [...currentState.projects, newProject],
    }));

    return newProject;
  },
  getProjects: async () => {
    const state = await storage.get();
    return state.projects;
  },
  updateProject: async (id: string, updates: ProjectUpdatePayload) => {
    await storage.set(currentState => ({
      ...currentState,
      projects: currentState.projects.map(project =>
        project.id === id
          ? { ...project, ...updates, lastModified: Date.now() }
          : project,
      ),
    }));
  },
  deleteProject: async (id: string) => {
    await storage.set(currentState => ({
      ...currentState,
      projects: currentState.projects.filter(project => project.id !== id),
    }));
  },
};
