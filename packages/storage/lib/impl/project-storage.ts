import { request, mapApiProject } from './backend-client.js';
import type { ApiProject } from './backend-client.js';
import type { Project, ProjectCreateInput, ProjectUpdatePayload } from '@extension/types';

export const projectsStorage = {
  addProject: async (input: ProjectCreateInput): Promise<Project> => {
    const created = await request<ApiProject>('/projects', {
      method: 'POST',
      body: JSON.stringify({ name: input.name, color: input.color }),
    });
    return mapApiProject(created);
  },
  getProjects: async (): Promise<Project[]> => {
    const projects = await request<ApiProject[]>('/projects');
    return projects.map(mapApiProject);
  },
  updateProject: async (id: string, updates: ProjectUpdatePayload): Promise<void> => {
    await request<ApiProject>(`/projects/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ name: updates.name, color: updates.color }),
    });
  },
  deleteProject: async (id: string): Promise<void> => {
    await request<{ deleted: number }>(`/projects/${id}`, { method: 'DELETE' });
  },
};
