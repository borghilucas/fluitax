import { redirect } from 'next/navigation';

export default function KardexIndexPage() {
  redirect('/app/reports/kardex/movimentacao');
}
