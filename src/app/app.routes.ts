import { Routes } from '@angular/router';
import { PublicLayout } from './public/public-layout';

export const routes: Routes = [
  {
    path: '',
    component: PublicLayout,
    children: [],
  },
];
