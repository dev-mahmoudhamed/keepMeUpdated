import { Routes } from '@angular/router';
import { PublicLayout } from './public/public-layout';

export const routes: Routes = [
  {
    path: '',
    component: PublicLayout,
    children: [
      {
        path: '',
        title: 'keepMeUpdated · developer news that matters',
        loadComponent: () => import('./public/home/home').then((m) => m.Home),
      },
    ],
  },
];
