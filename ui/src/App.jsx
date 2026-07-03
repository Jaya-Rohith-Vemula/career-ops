import { BrowserRouter, Routes, Route, NavLink } from 'react-router-dom';
import Dashboard from './pages/Dashboard';
import Jobs from './pages/Jobs';
import Companies from './pages/Companies';
import './App.css';

export default function App() {
  return (
    <BrowserRouter>
      <div className="app">
        <nav>
          <div className="brand">Job Pipeline</div>
          <NavLink to="/" end>Dashboard</NavLink>
          <NavLink to="/jobs">Jobs</NavLink>
          <NavLink to="/companies">Companies</NavLink>
        </nav>
        <main>
          <Routes>
            <Route path="/" element={<Dashboard />} />
            <Route path="/jobs" element={<Jobs />} />
            <Route path="/companies" element={<Companies />} />
          </Routes>
        </main>
      </div>
    </BrowserRouter>
  );
}
