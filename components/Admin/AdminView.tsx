'use client';

import { useEffect, useState } from 'react';
import {
  Users, ShieldCheck, ShieldOff, Trash2, Loader2, AlertCircle,
  Gift, GiftIcon, X, Send, Clock, CheckCircle2, MailPlus, UserCheck, UserX,
} from 'lucide-react';
import { api } from '@/lib/api';
import { useAuthStore } from '@/lib/authStore';

interface AdminUser {
  id: string;
  name: string;
  email: string;
  picture_url: string | null;
  is_admin: boolean;
  has_complimentary_access: boolean;
  created_at: string;
  last_active: string | null;
  entry_count: number;
}

interface AdminInvitation {
  id: string;
  email: string;
  invited_by: string;
  created_at: string;
  expires_at: string;
  accepted_at: string | null;
  is_expired: boolean;
}

interface AccessRequestItem {
  id: string;
  email: string;
  name: string;
  picture_url: string | null;
  status: string;
  requested_at: string;
}

type Tab = 'users' | 'invitations' | 'requests';

export function AdminView() {
  const currentUser = useAuthStore((s) => s.user);
  const [tab, setTab] = useState<Tab>('users');

  // Users state
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [usersLoading, setUsersLoading] = useState(true);

  // Invitations state
  const [invitations, setInvitations] = useState<AdminInvitation[]>([]);
  const [invitesLoading, setInvitesLoading] = useState(true);

  // Access requests state
  const [accessRequests, setAccessRequests] = useState<AccessRequestItem[]>([]);
  const [requestsLoading, setRequestsLoading] = useState(true);
  const [inviteEmail, setInviteEmail] = useState('');
  const [sendingInvite, setSendingInvite] = useState(false);

  const [error, setError] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<AdminUser | null>(null);

  useEffect(() => {
    api.adminListUsers()
      .then(setUsers)
      .catch((e) => setError(e.message))
      .finally(() => setUsersLoading(false));

    api.adminListInvitations()
      .then(setInvitations)
      .catch((e) => setError(e.message))
      .finally(() => setInvitesLoading(false));

    api.adminListAccessRequests()
      .then(setAccessRequests)
      .catch((e) => setError(e.message))
      .finally(() => setRequestsLoading(false));
  }, []);

  const handleToggleAdmin = async (user: AdminUser) => {
    setActionLoading(`admin-${user.id}`);
    try {
      const updated = await api.adminPatchUser(user.id, { is_admin: !user.is_admin });
      setUsers((prev) => prev.map((u) => (u.id === updated.id ? updated : u)));
    } catch (e: any) {
      setError(e.message);
    } finally {
      setActionLoading(null);
    }
  };

  const handleToggleComplimentary = async (user: AdminUser) => {
    setActionLoading(`comp-${user.id}`);
    try {
      const updated = await api.adminPatchUser(user.id, {
        has_complimentary_access: !user.has_complimentary_access,
      });
      setUsers((prev) => prev.map((u) => (u.id === updated.id ? updated : u)));
    } catch (e: any) {
      setError(e.message);
    } finally {
      setActionLoading(null);
    }
  };

  const handleDeleteConfirmed = async () => {
    if (!confirmDelete) return;
    setActionLoading(`del-${confirmDelete.id}`);
    try {
      await api.adminDeleteUser(confirmDelete.id);
      setUsers((prev) => prev.filter((u) => u.id !== confirmDelete.id));
      setConfirmDelete(null);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setActionLoading(null);
    }
  };

  const handleSendInvite = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!inviteEmail.trim()) return;
    setSendingInvite(true);
    setError(null);
    try {
      const inv = await api.adminCreateInvitation(inviteEmail.trim());
      setInvitations((prev) => [inv, ...prev]);
      setInviteEmail('');
    } catch (e: any) {
      setError(e.message);
    } finally {
      setSendingInvite(false);
    }
  };

  const handleRevokeInvite = async (inv: AdminInvitation) => {
    setActionLoading(`inv-${inv.id}`);
    try {
      await api.adminRevokeInvitation(inv.id);
      setInvitations((prev) => prev.filter((i) => i.id !== inv.id));
    } catch (e: any) {
      setError(e.message);
    } finally {
      setActionLoading(null);
    }
  };

  const handleApproveRequest = async (req: AccessRequestItem) => {
    setActionLoading(`req-${req.id}`);
    try {
      const inv = await api.adminApproveAccessRequest(req.id);
      setAccessRequests((prev) => prev.map((r) => r.id === req.id ? { ...r, status: 'approved' } : r));
      setInvitations((prev) => [inv, ...prev]);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setActionLoading(null);
    }
  };

  const handleDeclineRequest = async (req: AccessRequestItem) => {
    setActionLoading(`req-${req.id}`);
    try {
      await api.adminDeclineAccessRequest(req.id);
      setAccessRequests((prev) => prev.map((r) => r.id === req.id ? { ...r, status: 'declined' } : r));
    } catch (e: any) {
      setError(e.message);
    } finally {
      setActionLoading(null);
    }
  };

  const isLoading = usersLoading || invitesLoading || requestsLoading;

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 size={28} className="animate-spin text-primary-500" />
      </div>
    );
  }

  return (
    <div className="max-w-5xl mx-auto px-4 py-6 space-y-6">
      <div className="flex items-center gap-3">
        <ShieldCheck className="text-primary-600 dark:text-primary-400" size={24} />
        <h1 className="text-2xl font-bold text-slate-900 dark:text-white">Admin</h1>
      </div>

      {error && (
        <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-3 flex items-start gap-2">
          <AlertCircle className="text-red-500 shrink-0 mt-0.5" size={16} />
          <p className="text-sm text-red-700 dark:text-red-300 flex-1">{error}</p>
          <button onClick={() => setError(null)} className="text-red-400 hover:text-red-600">
            <X size={14} />
          </button>
        </div>
      )}

      {/* Tabs */}
      <div className="flex gap-1 border-b border-slate-200 dark:border-slate-700">
        {([
        ['users', 'Users', users.length],
        ['requests', 'Access Requests', accessRequests.filter(r => r.status === 'pending').length],
        ['invitations', 'Invitations', invitations.length],
      ] as const).map(([id, label, count]) => (
          <button
            key={id}
            onClick={() => setTab(id)}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors -mb-px ${
              tab === id
                ? 'border-primary-500 text-primary-600 dark:text-primary-400'
                : 'border-transparent text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200'
            }`}
          >
            {label}
            <span className="ml-1.5 text-xs bg-slate-100 dark:bg-slate-700 text-slate-500 dark:text-slate-400 px-1.5 py-0.5 rounded-full">
              {count}
            </span>
          </button>
        ))}
      </div>

      {/* Users tab */}
      {tab === 'users' && (
        <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-700/50">
                <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wide">User</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wide hidden sm:table-cell">Joined</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wide hidden md:table-cell">Last Active</th>
                <th className="text-right px-4 py-3 text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wide">Entries</th>
                <th className="text-right px-4 py-3 text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wide">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-700">
              {users.map((user) => {
                const isSelf = user.id === currentUser?.id;
                return (
                  <tr key={user.id} className="hover:bg-slate-50 dark:hover:bg-slate-700/30 transition-colors">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3">
                        {user.picture_url ? (
                          <img src={user.picture_url} alt="" className="w-8 h-8 rounded-full shrink-0" />
                        ) : (
                          <div className="w-8 h-8 rounded-full bg-primary-100 dark:bg-primary-900/30 flex items-center justify-center shrink-0">
                            <span className="text-xs font-semibold text-primary-600 dark:text-primary-400">
                              {user.name.charAt(0).toUpperCase()}
                            </span>
                          </div>
                        )}
                        <div className="min-w-0">
                          <p className="font-medium text-slate-900 dark:text-white truncate">
                            {user.name}
                            {isSelf && <span className="ml-1.5 text-xs text-slate-400">(you)</span>}
                          </p>
                          <p className="text-xs text-slate-500 dark:text-slate-400 truncate">{user.email}</p>
                        </div>
                        <div className="flex gap-1 shrink-0 flex-wrap">
                          {user.is_admin && (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-indigo-100 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-300">
                              <ShieldCheck size={10} /> Admin
                            </span>
                          )}
                          {user.has_complimentary_access && (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300">
                              <GiftIcon size={10} /> Comp
                            </span>
                          )}
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-slate-500 dark:text-slate-400 hidden sm:table-cell">{user.created_at}</td>
                    <td className="px-4 py-3 text-slate-500 dark:text-slate-400 hidden md:table-cell">{user.last_active ?? '—'}</td>
                    <td className="px-4 py-3 text-right font-medium text-slate-700 dark:text-slate-300">{user.entry_count}</td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-end gap-1">
                        {/* Toggle complimentary access */}
                        <button
                          onClick={() => handleToggleComplimentary(user)}
                          disabled={!!actionLoading}
                          title={user.has_complimentary_access ? 'Revoke complimentary access' : 'Grant complimentary access'}
                          className={`p-1.5 rounded-lg transition-colors disabled:opacity-40 ${
                            user.has_complimentary_access
                              ? 'text-emerald-600 dark:text-emerald-400 hover:bg-emerald-50 dark:hover:bg-emerald-900/20'
                              : 'text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700 hover:text-emerald-600 dark:hover:text-emerald-400'
                          }`}
                        >
                          {actionLoading === `comp-${user.id}` ? (
                            <Loader2 size={15} className="animate-spin" />
                          ) : (
                            <Gift size={15} />
                          )}
                        </button>
                        {/* Toggle admin */}
                        <button
                          onClick={() => handleToggleAdmin(user)}
                          disabled={!!actionLoading || isSelf}
                          title={user.is_admin ? 'Revoke admin' : 'Grant admin'}
                          className={`p-1.5 rounded-lg transition-colors disabled:opacity-40 ${
                            user.is_admin
                              ? 'text-indigo-600 dark:text-indigo-400 hover:bg-indigo-50 dark:hover:bg-indigo-900/20'
                              : 'text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700 hover:text-indigo-600 dark:hover:text-indigo-400'
                          }`}
                        >
                          {actionLoading === `admin-${user.id}` ? (
                            <Loader2 size={15} className="animate-spin" />
                          ) : user.is_admin ? (
                            <ShieldOff size={15} />
                          ) : (
                            <ShieldCheck size={15} />
                          )}
                        </button>
                        {/* Delete */}
                        <button
                          onClick={() => setConfirmDelete(user)}
                          disabled={!!actionLoading || isSelf}
                          title="Delete user"
                          className="p-1.5 rounded-lg text-slate-400 hover:bg-red-50 dark:hover:bg-red-900/20 hover:text-red-500 transition-colors disabled:opacity-40"
                        >
                          <Trash2 size={15} />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Access Requests tab */}
      {tab === 'requests' && (
        <div className="space-y-4">
          {accessRequests.length === 0 ? (
            <p className="text-sm text-slate-500 dark:text-slate-400 text-center py-8">No access requests yet.</p>
          ) : (
            <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-700/50">
                    <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wide">Requester</th>
                    <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wide hidden sm:table-cell">Requested</th>
                    <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wide">Status</th>
                    <th className="text-right px-4 py-3 text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wide">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-700">
                  {accessRequests.map((req) => (
                    <tr key={req.id} className="hover:bg-slate-50 dark:hover:bg-slate-700/30 transition-colors">
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-3">
                          {req.picture_url ? (
                            <img src={req.picture_url} alt="" className="w-8 h-8 rounded-full shrink-0" />
                          ) : (
                            <div className="w-8 h-8 rounded-full bg-slate-100 dark:bg-slate-700 flex items-center justify-center shrink-0">
                              <span className="text-xs font-semibold text-slate-500">{req.name.charAt(0).toUpperCase()}</span>
                            </div>
                          )}
                          <div className="min-w-0">
                            <p className="font-medium text-slate-900 dark:text-white truncate">{req.name}</p>
                            <p className="text-xs text-slate-500 dark:text-slate-400 truncate">{req.email}</p>
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-slate-500 dark:text-slate-400 hidden sm:table-cell">{req.requested_at}</td>
                      <td className="px-4 py-3">
                        {req.status === 'pending' && (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300">
                            <Clock size={10} /> Pending
                          </span>
                        )}
                        {req.status === 'approved' && (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300">
                            <CheckCircle2 size={10} /> Approved
                          </span>
                        )}
                        {req.status === 'declined' && (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-slate-100 dark:bg-slate-700 text-slate-500 dark:text-slate-400">
                            <X size={10} /> Declined
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        {req.status === 'pending' && (
                          <div className="flex items-center justify-end gap-2">
                            <button
                              onClick={() => handleApproveRequest(req)}
                              disabled={!!actionLoading}
                              title="Approve — sends invite email"
                              className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-medium bg-emerald-50 dark:bg-emerald-900/20 text-emerald-700 dark:text-emerald-300 hover:bg-emerald-100 dark:hover:bg-emerald-900/40 transition-colors disabled:opacity-50"
                            >
                              {actionLoading === `req-${req.id}` ? <Loader2 size={12} className="animate-spin" /> : <UserCheck size={12} />}
                              Approve
                            </button>
                            <button
                              onClick={() => handleDeclineRequest(req)}
                              disabled={!!actionLoading}
                              title="Decline"
                              className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-medium bg-slate-50 dark:bg-slate-700 text-slate-600 dark:text-slate-300 hover:bg-red-50 dark:hover:bg-red-900/20 hover:text-red-600 dark:hover:text-red-400 transition-colors disabled:opacity-50"
                            >
                              <UserX size={12} />
                              Decline
                            </button>
                          </div>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Invitations tab */}
      {tab === 'invitations' && (
        <div className="space-y-4">
          {/* Send invite form */}
          <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl p-4">
            <h3 className="text-sm font-semibold text-slate-900 dark:text-white mb-3 flex items-center gap-2">
              <MailPlus size={16} className="text-primary-500" />
              Invite someone
            </h3>
            <form onSubmit={handleSendInvite} className="flex gap-2">
              <input
                type="email"
                required
                placeholder="email@example.com"
                value={inviteEmail}
                onChange={(e) => setInviteEmail(e.target.value)}
                className="flex-1 px-3 py-2 text-sm border border-slate-200 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-900 text-slate-900 dark:text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-primary-500"
              />
              <button
                type="submit"
                disabled={sendingInvite || !inviteEmail.trim()}
                className="flex items-center gap-2 px-4 py-2 bg-primary-600 hover:bg-primary-700 text-white text-sm font-medium rounded-lg transition-colors disabled:opacity-50"
              >
                {sendingInvite ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
                Send invite
              </button>
            </form>
            <p className="text-xs text-slate-400 dark:text-slate-500 mt-2">
              Invite expires in 7 days. The invitee will receive an email if SMTP is configured, otherwise share the link manually.
            </p>
          </div>

          {/* Invitations table */}
          {invitations.length === 0 ? (
            <p className="text-sm text-slate-500 dark:text-slate-400 text-center py-8">No invitations sent yet.</p>
          ) : (
            <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-700/50">
                    <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wide">Email</th>
                    <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wide hidden sm:table-cell">Invited by</th>
                    <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wide hidden md:table-cell">Expires</th>
                    <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wide">Status</th>
                    <th className="text-right px-4 py-3 text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wide">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-700">
                  {invitations.map((inv) => (
                    <tr key={inv.id} className="hover:bg-slate-50 dark:hover:bg-slate-700/30 transition-colors">
                      <td className="px-4 py-3 text-slate-800 dark:text-slate-200 font-medium">{inv.email}</td>
                      <td className="px-4 py-3 text-slate-500 dark:text-slate-400 hidden sm:table-cell">{inv.invited_by}</td>
                      <td className="px-4 py-3 text-slate-500 dark:text-slate-400 hidden md:table-cell">{inv.expires_at}</td>
                      <td className="px-4 py-3">
                        {inv.accepted_at ? (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300">
                            <CheckCircle2 size={10} /> Accepted {inv.accepted_at}
                          </span>
                        ) : inv.is_expired ? (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-slate-100 dark:bg-slate-700 text-slate-500 dark:text-slate-400">
                            <Clock size={10} /> Expired
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300">
                            <Clock size={10} /> Pending
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right">
                        {!inv.accepted_at && (
                          <button
                            onClick={() => handleRevokeInvite(inv)}
                            disabled={actionLoading === `inv-${inv.id}`}
                            title="Revoke invite"
                            className="p-1.5 rounded-lg text-slate-400 hover:bg-red-50 dark:hover:bg-red-900/20 hover:text-red-500 transition-colors disabled:opacity-40"
                          >
                            {actionLoading === `inv-${inv.id}` ? (
                              <Loader2 size={14} className="animate-spin" />
                            ) : (
                              <X size={14} />
                            )}
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Delete confirmation modal */}
      {confirmDelete && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white dark:bg-slate-800 rounded-xl p-6 max-w-sm w-full space-y-4 shadow-xl">
            <h3 className="text-lg font-semibold text-slate-900 dark:text-white">Delete user?</h3>
            <p className="text-sm text-slate-600 dark:text-slate-400">
              This will permanently delete{' '}
              <span className="font-medium text-slate-900 dark:text-white">{confirmDelete.name}</span>{' '}
              and all their data. This cannot be undone.
            </p>
            <div className="flex gap-3">
              <button
                onClick={() => setConfirmDelete(null)}
                className="flex-1 px-4 py-2 rounded-lg border border-slate-200 dark:border-slate-600 text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors text-sm font-medium"
              >
                Cancel
              </button>
              <button
                onClick={handleDeleteConfirmed}
                disabled={actionLoading === `del-${confirmDelete.id}`}
                className="flex-1 px-4 py-2 rounded-lg bg-red-500 hover:bg-red-600 text-white transition-colors text-sm font-medium disabled:opacity-50 flex items-center justify-center gap-2"
              >
                {actionLoading === `del-${confirmDelete.id}` && <Loader2 size={14} className="animate-spin" />}
                Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
