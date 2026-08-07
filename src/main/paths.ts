import { app } from 'electron';
import { join } from 'node:path';

export type AppPaths = {
  todoFile: string;
  scheduledTodosFile: string;
  settingsFile: string;
  aiApiInfoFile: string;
  codexPets: string;
  appPets: string;
  packageRoot: string;
};

export function getAppPaths(): AppPaths {
  const appDataRoot = join(app.getPath('appData'), 'TOList');
  return {
    todoFile: join(app.getPath('documents'), 'TOList', 'todos.md'),
    scheduledTodosFile: join(appDataRoot, 'scheduled-todos.json'),
    settingsFile: join(appDataRoot, 'settings.json'),
    aiApiInfoFile: join(appDataRoot, 'ai-api.json'),
    codexPets: join(app.getPath('home'), '.codex', 'pets'),
    appPets: join(appDataRoot, 'pets'),
    packageRoot: join(appDataRoot, 'pet-packages')
  };
}
