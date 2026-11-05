import type { Institution } from './types';
export function institutionLogo(institution: Institution) {
  return (
    institution.logo ??
    (institution.id === 'sena'
      ? '/assets/teaching/logoSena.png'
      : institution.id === 'politecnico'
        ? '/assets/teaching/LogoPoli.png'
        : null)
  );
}
