import { Routes } from '@angular/router';

import { Homepage } from './pages/homepage/homepage';
import { CharacterListPage } from './pages/character-list-page/character-list-page';
import { CharacterCreationPage } from './pages/character-creation-page/character-creation-page';
import { PacksPage } from './pages/packs-page/packs-page';

export const routes: Routes = [
  {
    path: '',
    component: Homepage,
  },
  {
    path: 'characters',
    component: CharacterListPage,
  },
  {
    path: 'packs',
    component: PacksPage,
  },
  {
    path: 'character/new',
    component: CharacterCreationPage,
    children: [
      
    ]
  },
];
