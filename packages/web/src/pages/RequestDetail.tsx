import { useParams, useNavigate } from 'react-router-dom';
import { useState } from 'react';
import { useRequest, useCloseRequest, useSendMessage } from '../hooks/useApi';
import { StatusBadge, UrgencyBadge, Spinner, PageHeader } from '../components/UI';
import { ArrowLeft, Send, XCircle } from 'lucide-react';

export function RequestDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { data, isLoading } = useRequest(id!);
  const closeReq = useCloseRequest();
  const sendMsg = useSendMessage();
  const [reply, setReply] = useState('');

  if (isLoading) return <div className="flex justify-center py-20"><Spinner /></div>;
  if (!data) return null;

  const { request: r, messages } = data;

  const handleReply = async () => {
    if (!reply.trim()) return;
    await sendMsg.mutateAsync({ requestId: id!, body: reply });
    setReply('');
  };

  const handleClose = async () => {
    await closeReq.mutateAsync({ id: id!, resolution: 'Closed from dashboard' });
    navigate('/requests');
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <button onClick={() => navigate('/requests')} className="text-gray-400 hover:text-gray-600">
          <ArrowLeft size={20} />
        </button>
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Request {r.id.slice(0, 8)}</h1>
          <div className="flex items-center gap-3 mt-1">
            <StatusBadge status={r.status} />
            <UrgencyBadge urgency={r.urgency} />
            {r.category && <span className="badge bg-gray-100 text-gray-600">{r.category}</span>}
            {r.confidence && <span className="text-xs text-gray-400">confidence {(r.confidence * 100).toFixed(0)}%</span>}
          </div>
        </div>
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-6">
          <div className="card">
            <h3 className="text-sm font-medium text-gray-500 mb-2">Original Message</h3>
            <p className="text-gray-700">{r.body}</p>
            {r.summary && (
              <p className="text-sm text-gray-500 mt-2 italic">{r.summary}</p>
            )}
            {r.aiNotes && (
              <div className="mt-3 p-3 bg-gray-50 rounded-lg">
                <p className="text-xs font-medium text-gray-500 mb-1">AI Notes</p>
                <pre className="text-xs text-gray-600 whitespace-pre-wrap">{JSON.stringify(r.aiNotes, null, 2)}</pre>
              </div>
            )}
          </div>
          <div className="card">
            <h3 className="text-sm font-medium text-gray-500 mb-4">Conversation</h3>
            <div className="space-y-3">
              {messages.map((m) => (
                <div key={m.id} className={`flex ${m.direction === 'outbound' ? 'justify-end' : 'justify-start'}`}>
                  <div className={`max-w-lg px-4 py-2.5 rounded-2xl text-sm ${
                    m.direction === 'outbound'
                      ? 'bg-brand-600 text-white rounded-br-md'
                      : 'bg-gray-100 text-gray-800 rounded-bl-md'
                  }`}>
                    <p className="text-xs opacity-60 mb-1">{m.senderType} · {new Date(m.createdAt).toLocaleTimeString()}</p>
                    <p>{m.body}</p>
                  </div>
                </div>
              ))}
            </div>
            {r.status !== 'closed' && r.status !== 'completed' && (
              <div className="flex gap-2 mt-4 pt-4 border-t border-gray-100">
                <input
                  value={reply}
                  onChange={(e) => setReply(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleReply()}
                  placeholder="Type a message to the resident..."
                  className="input flex-1"
                />
                <button onClick={handleReply} disabled={!reply.trim() || sendMsg.isPending} className="btn-primary">
                  <Send size={16} />
                </button>
              </div>
            )}
          </div>
        </div>
        <div className="space-y-4">
          <div className="card">
            <h3 className="text-sm font-medium text-gray-500 mb-3">Details</h3>
            <dl className="space-y-2 text-sm">
              <div className="flex justify-between"><dt className="text-gray-500">Source</dt><dd className="font-medium">{r.source}</dd></div>
              <div className="flex justify-between"><dt className="text-gray-500">Created</dt><dd className="font-medium">{new Date(r.createdAt).toLocaleString()}</dd></div>
            </dl>
          </div>
          {r.status !== 'closed' && r.status !== 'completed' && (
            <button onClick={handleClose} disabled={closeReq.isPending} className="btn-danger w-full">
              <XCircle size={16} className="mr-2" />
              Close Request
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
