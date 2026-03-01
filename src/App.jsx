import { useState, useEffect } from 'react';
import Map from './components/Map';
import AddNestButton from './components/AddNestButton';
import NestBottomSheet from './components/NestBottomSheet';
import LoginScreen from './screens/LoginScreen';
import ForgotPasswordScreen from './screens/ForgotPasswordScreen';
import ResetPasswordScreen from './screens/ResetPasswordScreen';
import ChangePasswordScreen from './screens/ChangePasswordScreen';
import UserManagementScreen from './screens/UserManagementScreen';
import { loadNests, addNest, addLogToNest, deleteNest, updateNestLocation, updateNestName, fetchNearestAmenityName } from './services/nestService';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import { LogOut, KeyRound, Users, Egg } from 'lucide-react';
import './App.css';

// We separate the actual app content from the provider wrapper so we can use useAuth hook
function MainApp() {
  const { isAuthenticated, token, logout, user } = useAuth();
  const [nests, setNests] = useState([]);
  const [isAddingMode, setIsAddingMode] = useState(false);
  const [movingNest, setMovingNest] = useState(null);
  const [selectedNest, setSelectedNest] = useState(null);
  const [visibleNests, setVisibleNests] = useState([]);

  // Auth & UI Screen State
  const [showForgot, setShowForgot] = useState(false);
  const [showChangePassword, setShowChangePassword] = useState(false);
  const [showUserManagement, setShowUserManagement] = useState(false);
  const [showStats, setShowStats] = useState(false);

  // Check for reset token in URL
  const urlParams = new URLSearchParams(window.location.search);
  const resetToken = urlParams.get('reset_token');

  // Helper to refresh data from server
  const refreshNests = async () => {
    if (!isAuthenticated) return;
    const data = await loadNests(token);
    setNests(data);
  };

  useEffect(() => {
    refreshNests();
  }, [isAuthenticated, token]);

  // Calculate eggs swapped today
  const today = new Date().setHours(0, 0, 0, 0);
  const swappedEggsToday = nests.reduce((total, nest) => {
    if (!nest.logs) return total;
    const swapsToday = nest.logs.filter(log => {
      const logDate = new Date(log.timestamp).setHours(0, 0, 0, 0);
      return logDate === today &&
        log.action.startsWith('Taubeneier gegen Kunststoffeier getauscht') &&
        log.user_name === user?.username;
    });

    // Parse the amount from the action string, e.g. "Taubeneier gegen Kunststoff getauscht (1 Ei)"
    // Default to 2 for older logs without explicit counts
    const eggsFromSwaps = swapsToday.reduce((sum, log) => {
      const match = log.action.match(/\((\d+) Ei(?:er)?\)/);
      return sum + (match ? parseInt(match[1], 10) : 2);
    }, 0);

    return total + eggsFromSwaps;
  }, 0);

  // Calculate visible nest status counts
  const countVisibleNestsByStatus = () => {
    const counts = { neu: 0, getauscht: 0, verlassen: 0, entfernt: 0, bebruetet: 0 };
    visibleNests.forEach(nest => {
      if (!nest.logs || nest.logs.length === 0) {
        counts.neu++;
        return;
      }

      const statusLog = nest.logs.find(log =>
        !log.action.startsWith('Name geändert zu') &&
        !log.action.startsWith('Nest angelegt') &&
        !log.action.startsWith('Foto hinzugefügt')
      );

      const action = statusLog ? statusLog.action : 'Neues Nest';

      if (action.startsWith('Taubeneier gegen Kunststoffeier getauscht')) counts.getauscht++;
      else if (action === 'Nest verlassen') counts.verlassen++;
      else if (action.startsWith('Kunststoffeier entfernt')) counts.entfernt++;
      else if (action.startsWith('Kunststoffeier werden bebrütet')) counts.bebruetet++;
      else counts.neu++;
    });
    return counts;
  };
  const statusCounts = countVisibleNestsByStatus();

  // Handle Unauthenticated State Routing
  if (!isAuthenticated && resetToken) {
    return <ResetPasswordScreen token={resetToken} onBackToLogin={() => window.location.href = '/'} />;
  }

  if (!isAuthenticated && showForgot) {
    return <ForgotPasswordScreen onBackToLogin={() => setShowForgot(false)} />;
  }

  if (!isAuthenticated) {
    return <LoginScreen onForgotPassword={() => setShowForgot(true)} />;
  }

  // --- Authenticated App Flow ---

  const handleToggleAddMode = () => {
    if (movingNest) {
      setMovingNest(null);
    } else {
      setIsAddingMode(!isAddingMode);
    }
    setSelectedNest(null);
  };

  const handleMapClick = async (latlng) => {
    if (isAddingMode) {
      setIsAddingMode(false); // Stop adding mode immediately

      // Immediately display a temporary loading pin
      const tempId = 'temp-' + Date.now();
      const tempNest = {
        id: tempId,
        lat: latlng.lat,
        lng: latlng.lng,
        name: 'Lädt...',
        isLoading: true,
        logs: []
      };
      setNests(prev => [...prev, tempNest]);

      // Fetch nearest amenity from OSM to auto-name the nest in the background
      const autoName = await fetchNearestAmenityName(latlng.lat, latlng.lng);
      await addNest(latlng, autoName, token);

      // Refresh will strip out the purely local tempNest and fetch the real one from DB
      await refreshNests();
      setSelectedNest(null);
    } else if (movingNest) {
      const success = await updateNestLocation(movingNest.id, latlng, token);
      if (success) {
        await refreshNests();
        setMovingNest(null);
        setSelectedNest(null);
      }
    } else {
      setSelectedNest(null);
    }
  };

  const handleNestAction = async (actionLabel) => {
    if (!selectedNest) return;
    await addLogToNest(selectedNest.id, actionLabel, token);
    await refreshNests();
    setSelectedNest(null); // Close the bottom sheet
  };

  const handleTitleChange = async (nestId, newName) => {
    const success = await updateNestName(nestId, newName, token);
    if (success) {
      await refreshNests();
      const updatedData = await loadNests(token);
      const updatedNest = updatedData.find(n => n.id === nestId);
      setSelectedNest(updatedNest);
    }
  };

  const handlePhotoUploaded = async (nestId) => {
    await refreshNests();
    const updatedData = await loadNests(token);
    const updatedNest = updatedData.find(n => n.id === nestId);
    setSelectedNest(updatedNest);
  };

  const handleDeleteRequest = async (nestId) => {
    if (window.confirm("Soll das Nest wirklich gelöscht werden?")) {
      await deleteNest(nestId, token);
      await refreshNests();
      setSelectedNest(null);
    }
  };

  const handleMoveRequest = (nest) => {
    setSelectedNest(null);
    setMovingNest(nest);
    setIsAddingMode(false);
  };

  return (
    <div className="app-container">
      <header className="app-header glass">
        <div style={{ display: 'flex', gap: '0.5rem' }}>
          {user?.is_admin && (
            <button
              className="logout-button"
              onClick={() => {
                setShowChangePassword(false);
                setShowUserManagement(!showUserManagement);
              }}
              aria-label="Benutzerverwaltung"
              style={{ padding: '0.5rem' }}
            >
              <Users size={20} />
            </button>
          )}
          <button
            className="logout-button"
            onClick={() => {
              setShowUserManagement(false);
              setShowChangePassword(!showChangePassword);
            }}
            aria-label="Passwort ändern"
            style={{ padding: '0.5rem' }}
          >
            <KeyRound size={20} />
          </button>
        </div>
        <h1 onClick={() => setShowStats(!showStats)} style={{ cursor: 'pointer' }}>NesterApp</h1>
        <button className="logout-button" onClick={logout} aria-label="Abmelden" style={{ padding: '0.5rem' }}>
          <LogOut size={20} />
        </button>
      </header>

      {showChangePassword && (
        <div style={{ position: 'absolute', top: '70px', left: '50%', transform: 'translateX(-50%)', zIndex: 1000, width: '90%', maxWidth: '400px' }}>
          <ChangePasswordScreen onClose={() => setShowChangePassword(false)} />
        </div>
      )}

      {showUserManagement && (
        <div style={{ position: 'absolute', top: '70px', left: '50%', transform: 'translateX(-50%)', zIndex: 1000, width: '90%', maxWidth: '400px' }}>
          <UserManagementScreen onClose={() => setShowUserManagement(false)} />
        </div>
      )}

      {showStats && (
        <div className="glass" style={{
          position: 'absolute',
          top: '70px',
          left: '50%',
          transform: 'translateX(-50%)',
          zIndex: 1000,
          padding: '0.8rem 1.2rem',
          borderRadius: 'var(--radius-lg)',
          boxShadow: 'var(--shadow-lg)',
          display: 'flex',
          flexDirection: 'column',
          gap: '0.6rem',
          fontWeight: '600',
          fontSize: '1rem',
          color: 'var(--primary-color)',
          border: '1px solid var(--border-color)'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', marginBottom: '1rem' }}>
            <Egg size={20} />
            <span>{swappedEggsToday} Eier von mir heute getauscht</span>
          </div>

          <div style={{ fontSize: '0.85rem', color: 'var(--text-color)', display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '1rem', borderBottom: '1px solid var(--border-color)', paddingBottom: '0.2rem', color: 'var(--text-muted)' }}>
              <span>Legend / Aktueller Bildausschnitt</span>
              <span>Anzahl</span>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '1rem' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <div style={{ width: '12px', height: '12px', borderRadius: '50%', backgroundColor: '#3b82f6', flexShrink: 0 }}></div>
                <span>Neues Nest / Nest angelegt</span>
              </div>
              <span style={{ fontWeight: 'bold' }}>{statusCounts.neu}</span>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '1rem' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <div style={{ width: '12px', height: '12px', borderRadius: '50%', backgroundColor: '#22c55e', flexShrink: 0 }}></div>
                <span>Eier gegen Kunststoff getauscht</span>
              </div>
              <span style={{ fontWeight: 'bold' }}>{statusCounts.getauscht}</span>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '1rem' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <div style={{ width: '12px', height: '12px', borderRadius: '50%', backgroundColor: '#eab308', flexShrink: 0 }}></div>
                <span>Kunststoffeier werden bebrütet</span>
              </div>
              <span style={{ fontWeight: 'bold' }}>{statusCounts.bebruetet}</span>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '1rem' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <div style={{ width: '12px', height: '12px', borderRadius: '50%', backgroundColor: '#ef4444', flexShrink: 0 }}></div>
                <span>Kunststoff-Eier entfernt</span>
              </div>
              <span style={{ fontWeight: 'bold' }}>{statusCounts.entfernt}</span>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '1rem' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <div style={{ width: '12px', height: '12px', borderRadius: '50%', backgroundColor: '#a855f7', flexShrink: 0 }}></div>
                <span>Nest verlassen</span>
              </div>
              <span style={{ fontWeight: 'bold' }}>{statusCounts.verlassen}</span>
            </div>
          </div>
        </div>
      )}

      <div className="map-wrapper">
        <Map
          nests={nests}
          onNestSelect={(nest) => {
            setSelectedNest(nest);
            setIsAddingMode(false);
            setMovingNest(null);
          }}
          onMapClick={handleMapClick}
          onVisibleNestsChange={setVisibleNests}
        />
      </div>

      {(!selectedNest) && (
        <AddNestButton
          isAdding={isAddingMode}
          isMoving={!!movingNest}
          onClick={handleToggleAddMode}
        />
      )}

      {selectedNest && (
        <NestBottomSheet
          nest={selectedNest}
          onClose={() => setSelectedNest(null)}
          onAction={handleNestAction}
          onTitleChange={handleTitleChange}
          onDeleteRequest={handleDeleteRequest}
          onMoveRequest={handleMoveRequest}
          onPhotoUploaded={handlePhotoUploaded}
        />
      )}
    </div>
  );
}

// Wrap the app with the AuthProvider so the context is available
export default function App() {
  return (
    <AuthProvider>
      <MainApp />
    </AuthProvider>
  );
}
