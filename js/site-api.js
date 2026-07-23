import { centralApiRequest } from './remote-auth.js?v=1.7.0';

export async function listRemoteSites() {
  const result = await centralApiRequest('/api/sites');
  return Array.isArray(result?.sites) ? result.sites : [];
}

export async function importLocalSites(sites) {
  return centralApiRequest('/api/sites/sync', {
    method: 'POST',
    body: { sites },
  });
}

export async function createRemoteSite(site) {
  const result = await centralApiRequest('/api/sites/create', {
    method: 'POST',
    body: {
      id: site.id,
      name: site.name,
      client: site.client,
      address: site.address,
      status: site.status,
      folderName: site.folderName || site.name,
    },
  });
  return result.site;
}

export async function updateRemoteSite(site) {
  const result = await centralApiRequest(`/api/sites/${encodeURIComponent(site.id)}`, {
    method: 'PUT',
    body: {
      name: site.name,
      client: site.client,
      address: site.address,
      status: site.status,
      folderName: site.folderName || site.name,
      expectedRevision: Number(site.serverRevision || 0),
    },
  });
  return result.site;
}

export async function deleteRemoteSite(site) {
  const revision = encodeURIComponent(String(Number(site.serverRevision || 0)));
  return centralApiRequest(`/api/sites/${encodeURIComponent(site.id)}?expectedRevision=${revision}`, {
    method: 'DELETE',
  });
}

export async function getRemoteSiteFavorites(context) {
  const result = await centralApiRequest(`/api/site-favorites/${encodeURIComponent(context)}`);
  return Array.isArray(result?.ids) ? result.ids : [];
}

export async function putRemoteSiteFavorites(context, ids) {
  const result = await centralApiRequest(`/api/site-favorites/${encodeURIComponent(context)}`, {
    method: 'PUT',
    body: { ids },
  });
  return Array.isArray(result?.ids) ? result.ids : [];
}
