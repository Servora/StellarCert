import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { certificateApi } from '../api';
import { AlertTriangle } from 'lucide-react';

const RevokeCertificate = () => {
    const [certificateId, setCertificateId] = useState('');
    const [reason, setReason] = useState('');
    const [loading, setLoading] = useState(false);
    const [message, setMessage] = useState({ type: '', text: '' });
    const navigate = useNavigate();

    const handleRevoke = async (e: React.FormEvent) => {
        e.preventDefault();
        setLoading(true);
        try {
            await certificateApi.revoke(certificateId, reason);
            setMessage({ type: 'success', text: 'Certificate revoked successfully' });
            setTimeout(() => navigate('/'), 2000);
        } catch (err: any) {
            setMessage({ type: 'error', text: err.message || 'Revocation failed' });
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="max-w-2xl mx-auto mt-12">
            <div className="bg-white p-8 rounded-lg shadow-md border-t-4 border-red-500">
                <div className="flex items-center gap-3 mb-6">
                    <AlertTriangle className="w-8 h-8 text-red-500" />
                    <h2 className="text-2xl font-bold">Revoke Certificate</h2>
                </div>

                <p className="text-gray-600 mb-6">
                    Warning: This action is permanent and will be recorded on the blockchain.
                </p>

                <form onSubmit={handleRevoke} className="space-y-4">
                    <div>
                        <label className="block text-sm font-medium text-gray-700">Certificate Serial Number / ID</label>
                        <input
                            type="text"
                            className="mt-1 block w-full border rounded-md px-3 py-2"
                            value={certificateId}
                            onChange={(e) => setCertificateId(e.target.value)}
                            required
                            placeholder="e.g. STC-2026-00023"
                        />
                    </div>
                    <div>
                        <label className="block text-sm font-medium text-gray-700">Reason for Revocation</label>
                        <textarea
                            className="mt-1 block w-full border rounded-md px-3 py-2 h-24"
                            value={reason}
                            onChange={(e) => setReason(e.target.value)}
                            required
                            placeholder="Brief explanation for why this certificate is being revoked"
                        />
                    </div>

                    {message.text && (
                        <div className={`p-3 rounded-md text-sm ${message.type === 'success' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'
                            }`}>
                            {message.text}
                        </div>
                    )}

                    <div className="flex justify-end gap-3 pt-4">
                        <button
                            type="button"
                            onClick={() => navigate('/')}
                            className="px-4 py-2 text-gray-600 hover:text-gray-800"
                        >
                            Cancel
                        </button>
                        <button
                            type="submit"
                            disabled={loading}
                            className="bg-red-600 text-white px-6 py-2 rounded-md hover:bg-red-700 disabled:bg-red-400"
                        >
                            {loading ? 'Revoking...' : 'Confirm Revocation'}
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
};

export default RevokeCertificate;
