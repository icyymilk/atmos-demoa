// Shared by Vite and the local migration runner so both use the same on-disk D1 database.
export function localBindings({ d1, r2 }) {
  return {
    d1_databases: d1 ? [{ binding: d1, database_name: 'site-creator-d1', database_id: '00000000-0000-4000-8000-000000000000' }] : [],
    r2_buckets: r2 ? [{ binding: r2, bucket_name: 'site-creator-r2' }] : [],
  };
}
