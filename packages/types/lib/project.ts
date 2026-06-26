export interface Project {
  id: string;
  name: string;
  color: string;
  createdAt: number;
  lastModified: number;
}

export type ProjectCreateInput = Pick<Project, 'name' | 'color'>;
export type ProjectUpdatePayload = Partial<Omit<Project, 'id' | 'createdAt'>>;
