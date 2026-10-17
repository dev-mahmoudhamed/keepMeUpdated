import { Routes } from '@angular/router';
import { PublicLayout } from './public/public-layout';

export const routes: Routes = [
  {
    path: 'admin',
    loadChildren: () => import('./admin/admin.routes').then((m) => m.adminRoutes),
  },
  {
    path: '',
    component: PublicLayout,
    children: [
      {
        path: '',
        title: 'keepMeUpdated · developer news that matters',
        loadComponent: () => import('./public/home/home').then((m) => m.Home),
      },
      {
        path: 'p/:slug',
        loadComponent: () => import('./public/post-page/post-page').then((m) => m.PostPage),
      },
      {
        path: '**',
        title: 'Not found · keepMeUpdated',
        loadComponent: () => import('./public/not-found/not-found').then((m) => m.NotFound),
      },
    ],
  },
];
