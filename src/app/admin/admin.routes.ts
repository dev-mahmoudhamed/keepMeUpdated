import type { Routes } from '@angular/router';
import { authGuard } from '../core/auth';
import { AdminShell } from './admin-shell/admin-shell';

export const adminRoutes: Routes = [
  {
    path: 'login',
    title: 'Sign in · keepMeUpdated',
    loadComponent: () => import('./login/login').then((m) => m.Login),
  },
  {
    path: '',
    component: AdminShell,
    canActivate: [authGuard],
    children: [
      {
        path: '',
        title: 'Posts · Admin',
        loadComponent: () => import('./posts-list/posts-list').then((m) => m.PostsList),
      },
      {
        path: 'posts/new',
        title: 'New post · Admin',
        loadComponent: () => import('./post-editor/post-editor').then((m) => m.PostEditor),
        canDeactivate: [(c: { canLeave(): boolean }) => c.canLeave()],
      },
      {
        path: 'posts/:id',
        title: 'Edit post · Admin',
        loadComponent: () => import('./post-editor/post-editor').then((m) => m.PostEditor),
        canDeactivate: [(c: { canLeave(): boolean }) => c.canLeave()],
      },
      {
        path: 'sources',
        title: 'Sources · Admin',
        loadComponent: () => import('./sources/sources').then((m) => m.Sources),
      },
      {
        path: 'runs',
        title: 'Gather runs · Admin',
        loadComponent: () => import('./runs/runs').then((m) => m.Runs),
      },
    ],
  },
];
