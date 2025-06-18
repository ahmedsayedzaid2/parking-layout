import { Routes } from '@angular/router';
import {ParkingLayout} from './parking-layout/parking-layout';

export const routes: Routes = [
  {
    path: 'parking-layout',
    component: ParkingLayout,
  },
  {
    path: '',
    redirectTo: '/parking-layout',
    pathMatch: 'full'
  }
];
