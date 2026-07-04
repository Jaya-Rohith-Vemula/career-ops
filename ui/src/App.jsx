import { BrowserRouter, Routes, Route, NavLink } from 'react-router-dom';
import Dashboard from './pages/Dashboard';
import Jobs from './pages/Jobs';
import YcImport from './pages/YcImport';
import './App.css';

export default function App() {
  return (
    <BrowserRouter>
      <div className="app">
        <nav>
          <div className="brand">
            <span className="brand-mark">JP</span>
            Job Pipeline
          </div>
          <div className="nav-links">
            <NavLink to="/" end>Dashboard</NavLink>
            <NavLink to="/jobs">Jobs</NavLink>
            <NavLink to="/yc-import">YC Import</NavLink>
          </div>
        </nav>
        <main>
          <Routes>
            <Route path="/" element={<Dashboard />} />
            <Route path="/jobs" element={<Jobs />} />
            <Route path="/yc-import" element={<YcImport />} />
          </Routes>
        </main>
      </div>
    </BrowserRouter>
  );
}
