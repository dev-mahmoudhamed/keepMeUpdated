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
    ],
  },
];
