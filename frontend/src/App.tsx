import { Navigate, Route, Routes } from 'react-router-dom';
import Layout from './components/Layout';
import Create from './pages/Create';
import Dashboard from './pages/Dashboard';
import Home from './pages/Home';
import VerifyCertificate from './pages/VerifyCertificate';
import View from './pages/View';

export default function App(): JSX.Element {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<Home />} />
        <Route path="verify" element={<VerifyCertificate />} />
        <Route path="create" element={<Create />} />
        <Route path="view" element={<View />} />
        <Route path="dashboard" element={<Dashboard />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}
