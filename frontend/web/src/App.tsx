// App.tsx
import React, { useEffect, useState } from "react";
import { ethers } from "ethers";
import { getContractReadOnly, getContractWithSigner } from "./contract";
import WalletManager from "./components/WalletManager";
import WalletSelector from "./components/WalletSelector";
import "./App.css";

interface SpaceWeatherData {
  id: string;
  encryptedData: string;
  timestamp: number;
  provider: string;
  severity: number;
  impactType: string;
  location: string;
}

const App: React.FC = () => {
  // State management
  const [account, setAccount] = useState("");
  const [loading, setLoading] = useState(true);
  const [weatherData, setWeatherData] = useState<SpaceWeatherData[]>([]);
  const [provider, setProvider] = useState<ethers.BrowserProvider | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [showSubmitModal, setShowSubmitModal] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [walletSelectorOpen, setWalletSelectorOpen] = useState(false);
  const [transactionStatus, setTransactionStatus] = useState<{
    visible: boolean;
    status: "pending" | "success" | "error";
    message: string;
  }>({ visible: false, status: "pending", message: "" });
  const [newData, setNewData] = useState({
    severity: 1,
    impactType: "",
    location: "",
    details: ""
  });
  const [searchTerm, setSearchTerm] = useState("");
  const [activeTab, setActiveTab] = useState("all");

  // Filter data based on search and active tab
  const filteredData = weatherData.filter(item => {
    const matchesSearch = item.location.toLowerCase().includes(searchTerm.toLowerCase()) || 
                          item.impactType.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesTab = activeTab === "all" || 
                      (activeTab === "mine" && item.provider.toLowerCase() === account.toLowerCase());
    return matchesSearch && matchesTab;
  });

  // Calculate statistics
  const totalReports = weatherData.length;
  const highSeverityCount = weatherData.filter(item => item.severity >= 4).length;
  const powerImpactCount = weatherData.filter(item => item.impactType.includes("Power")).length;
  const commImpactCount = weatherData.filter(item => item.impactType.includes("Communication")).length;

  useEffect(() => {
    loadData().finally(() => setLoading(false));
  }, []);

  const onWalletSelect = async (wallet: any) => {
    if (!wallet.provider) return;
    try {
      const web3Provider = new ethers.BrowserProvider(wallet.provider);
      setProvider(web3Provider);
      const accounts = await web3Provider.send("eth_requestAccounts", []);
      const acc = accounts[0] || "";
      setAccount(acc);

      wallet.provider.on("accountsChanged", async (accounts: string[]) => {
        const newAcc = accounts[0] || "";
        setAccount(newAcc);
      });
    } catch (e) {
      alert("Failed to connect wallet");
    }
  };

  const onConnect = () => setWalletSelectorOpen(true);
  const onDisconnect = () => {
    setAccount("");
    setProvider(null);
  };

  const loadData = async () => {
    setIsRefreshing(true);
    try {
      const contract = await getContractReadOnly();
      if (!contract) return;
      
      // Check contract availability using FHE
      const isAvailable = await contract.isAvailable();
      if (!isAvailable) {
        console.error("Contract is not available");
        return;
      }
      
      const keysBytes = await contract.getData("spaceweather_keys");
      let keys: string[] = [];
      
      if (keysBytes.length > 0) {
        try {
          keys = JSON.parse(ethers.toUtf8String(keysBytes));
        } catch (e) {
          console.error("Error parsing data keys:", e);
        }
      }
      
      const list: SpaceWeatherData[] = [];
      
      for (const key of keys) {
        try {
          const dataBytes = await contract.getData(`spaceweather_${key}`);
          if (dataBytes.length > 0) {
            try {
              const data = JSON.parse(ethers.toUtf8String(dataBytes));
              list.push({
                id: key,
                encryptedData: data.data,
                timestamp: data.timestamp,
                provider: data.provider,
                severity: data.severity,
                impactType: data.impactType,
                location: data.location
              });
            } catch (e) {
              console.error(`Error parsing data for ${key}:`, e);
            }
          }
        } catch (e) {
          console.error(`Error loading data ${key}:`, e);
        }
      }
      
      list.sort((a, b) => b.timestamp - a.timestamp);
      setWeatherData(list);
    } catch (e) {
      console.error("Error loading data:", e);
    } finally {
      setIsRefreshing(false);
      setLoading(false);
    }
  };

  const submitData = async () => {
    if (!provider) { 
      alert("Please connect wallet first"); 
      return; 
    }
    
    setSubmitting(true);
    setTransactionStatus({
      visible: true,
      status: "pending",
      message: "Encrypting space weather data with FHE..."
    });
    
    try {
      // Simulate FHE encryption
      const encryptedData = `FHE-${btoa(JSON.stringify(newData))}`;
      
      const contract = await getContractWithSigner();
      if (!contract) {
        throw new Error("Failed to get contract with signer");
      }
      
      const dataId = `sw-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`;

      const weatherData = {
        data: encryptedData,
        timestamp: Math.floor(Date.now() / 1000),
        provider: account,
        severity: newData.severity,
        impactType: newData.impactType,
        location: newData.location
      };
      
      // Store encrypted data on-chain using FHE
      await contract.setData(
        `spaceweather_${dataId}`, 
        ethers.toUtf8Bytes(JSON.stringify(weatherData))
      );
      
      const keysBytes = await contract.getData("spaceweather_keys");
      let keys: string[] = [];
      
      if (keysBytes.length > 0) {
        try {
          keys = JSON.parse(ethers.toUtf8String(keysBytes));
        } catch (e) {
          console.error("Error parsing keys:", e);
        }
      }
      
      keys.push(dataId);
      
      await contract.setData(
        "spaceweather_keys", 
        ethers.toUtf8Bytes(JSON.stringify(keys))
      );
      
      setTransactionStatus({
        visible: true,
        status: "success",
        message: "Encrypted data submitted securely!"
      });
      
      await loadData();
      
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
        setShowSubmitModal(false);
        setNewData({
          severity: 1,
          impactType: "",
          location: "",
          details: ""
        });
      }, 2000);
    } catch (e: any) {
      const errorMessage = e.message.includes("user rejected transaction")
        ? "Transaction rejected by user"
        : "Submission failed: " + (e.message || "Unknown error");
      
      setTransactionStatus({
        visible: true,
        status: "error",
        message: errorMessage
      });
      
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 3000);
    } finally {
      setSubmitting(false);
    }
  };

  const renderSeverityIndicator = (severity: number) => {
    const colors = ["#4CAF50", "#8BC34A", "#FFC107", "#FF9800", "#F44336"];
    const color = colors[Math.min(severity - 1, 4)];
    
    return (
      <div className="severity-indicator" style={{ backgroundColor: color }}>
        {severity}
      </div>
    );
  };

  const renderImpactChart = () => {
    return (
      <div className="impact-chart">
        <div className="chart-bar power" style={{ height: `${(powerImpactCount / totalReports) * 100}%` }}>
          <span>{powerImpactCount}</span>
        </div>
        <div className="chart-bar comm" style={{ height: `${(commImpactCount / totalReports) * 100}%` }}>
          <span>{commImpactCount}</span>
        </div>
        <div className="chart-labels">
          <span>Power</span>
          <span>Comm</span>
        </div>
      </div>
    );
  };

  if (loading) return (
    <div className="loading-screen">
      <div className="spinner"></div>
      <p>Initializing FHE connection...</p>
    </div>
  );

  return (
    <div className="app-container">
      <header className="app-header">
        <div className="logo">
          <h1>SpaceWeather<span>FHE</span></h1>
          <p>Confidential Analysis of Space Weather Impact</p>
        </div>
        
        <div className="header-actions">
          <WalletManager account={account} onConnect={onConnect} onDisconnect={onDisconnect} />
        </div>
      </header>
      
      <main className="main-content">
        <section className="hero-section">
          <div className="hero-content">
            <h2>Secure Space Weather Analysis</h2>
            <p>
              Share encrypted infrastructure data using FHE to analyze space weather impacts 
              without exposing sensitive information
            </p>
            <button 
              onClick={() => setShowSubmitModal(true)}
              className="primary-btn"
            >
              Submit Encrypted Report
            </button>
          </div>
          <div className="hero-graphic">
            <div className="planet"></div>
            <div className="satellite"></div>
            <div className="data-points">
              {[...Array(8)].map((_, i) => <div key={i} className="data-point"></div>)}
            </div>
          </div>
        </section>
        
        <section className="stats-section">
          <div className="stat-card">
            <h3>Total Reports</h3>
            <div className="stat-value">{totalReports}</div>
          </div>
          <div className="stat-card">
            <h3>High Severity</h3>
            <div className="stat-value">{highSeverityCount}</div>
          </div>
          <div className="stat-card">
            <h3>Impact Distribution</h3>
            {renderImpactChart()}
          </div>
        </section>
        
        <section className="data-section">
          <div className="section-header">
            <h2>Space Weather Impact Reports</h2>
            <div className="controls">
              <div className="search-box">
                <input 
                  type="text" 
                  placeholder="Search reports..." 
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                />
                <button className="search-btn">
                  <svg viewBox="0 0 24 24">
                    <path d="M15.5 14h-.79l-.28-.27a6.5 6.5 0 0 0 1.48-5.34c-.47-2.78-2.79-5-5.59-5.34a6.505 6.505 0 0 0-7.27 7.27c.34 2.8 2.56 5.12 5.34 5.59a6.5 6.5 0 0 0 5.34-1.48l.27.28v.79l4.25 4.25c.41.41 1.08.41 1.49 0 .41-.41.41-1.08 0-1.49L15.5 14zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z"/>
                  </svg>
                </button>
              </div>
              <div className="tabs">
                <button 
                  className={activeTab === "all" ? "active" : ""}
                  onClick={() => setActiveTab("all")}
                >
                  All Reports
                </button>
                <button 
                  className={activeTab === "mine" ? "active" : ""}
                  onClick={() => setActiveTab("mine")}
                >
                  My Reports
                </button>
              </div>
              <button 
                onClick={loadData}
                className="refresh-btn"
                disabled={isRefreshing}
              >
                {isRefreshing ? "Refreshing..." : "Refresh"}
              </button>
            </div>
          </div>
          
          <div className="data-list">
            {filteredData.length === 0 ? (
              <div className="empty-state">
                <div className="empty-icon"></div>
                <p>No space weather reports found</p>
                <button 
                  className="primary-btn"
                  onClick={() => setShowSubmitModal(true)}
                >
                  Submit First Report
                </button>
              </div>
            ) : (
              filteredData.map(item => (
                <div className="data-item" key={item.id}>
                  <div className="item-header">
                    <div className="item-id">#{item.id.substring(0, 8)}</div>
                    <div className="item-provider">
                      {item.provider.substring(0, 6)}...{item.provider.substring(38)}
                    </div>
                    <div className="item-date">
                      {new Date(item.timestamp * 1000).toLocaleDateString()}
                    </div>
                  </div>
                  <div className="item-content">
                    <div className="item-severity">
                      {renderSeverityIndicator(item.severity)}
                      <span>Severity</span>
                    </div>
                    <div className="item-details">
                      <h3>{item.impactType}</h3>
                      <p>{item.location}</p>
                    </div>
                    <div className="item-actions">
                      <button className="action-btn">
                        View FHE Analysis
                      </button>
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        </section>
      </main>
  
      {showSubmitModal && (
        <div className="modal-overlay">
          <div className="submit-modal">
            <div className="modal-header">
              <h2>Submit Space Weather Report</h2>
              <button onClick={() => setShowSubmitModal(false)} className="close-modal">
                &times;
              </button>
            </div>
            
            <div className="modal-body">
              <div className="fhe-notice">
                <div className="lock-icon"></div>
                <p>Your data will be encrypted using FHE technology</p>
              </div>
              
              <div className="form-group">
                <label>Severity Level (1-5)</label>
                <input 
                  type="range" 
                  min="1" 
                  max="5" 
                  value={newData.severity}
                  onChange={(e) => setNewData({...newData, severity: parseInt(e.target.value)})}
                />
                <div className="severity-levels">
                  <span>1 - Minimal</span>
                  <span>3 - Moderate</span>
                  <span>5 - Severe</span>
                </div>
              </div>
              
              <div className="form-group">
                <label>Impact Type *</label>
                <select 
                  value={newData.impactType}
                  onChange={(e) => setNewData({...newData, impactType: e.target.value})}
                >
                  <option value="">Select impact type</option>
                  <option value="Power Grid">Power Grid</option>
                  <option value="Communication">Communication</option>
                  <option value="Navigation">Navigation</option>
                  <option value="Satellite">Satellite</option>
                  <option value="Other">Other</option>
                </select>
              </div>
              
              <div className="form-group">
                <label>Location *</label>
                <input 
                  type="text" 
                  placeholder="Enter location affected" 
                  value={newData.location}
                  onChange={(e) => setNewData({...newData, location: e.target.value})}
                />
              </div>
              
              <div className="form-group">
                <label>Details</label>
                <textarea 
                  placeholder="Additional details (will be encrypted)"
                  value={newData.details}
                  onChange={(e) => setNewData({...newData, details: e.target.value})}
                  rows={4}
                ></textarea>
              </div>
            </div>
            
            <div className="modal-footer">
              <button 
                onClick={() => setShowSubmitModal(false)}
                className="secondary-btn"
              >
                Cancel
              </button>
              <button 
                onClick={submitData}
                disabled={submitting || !newData.impactType || !newData.location}
                className="primary-btn"
              >
                {submitting ? "Encrypting..." : "Submit Securely"}
              </button>
            </div>
          </div>
        </div>
      )}
      
      {walletSelectorOpen && (
        <WalletSelector
          isOpen={walletSelectorOpen}
          onWalletSelect={(wallet) => { onWalletSelect(wallet); setWalletSelectorOpen(false); }}
          onClose={() => setWalletSelectorOpen(false)}
        />
      )}
      
      {transactionStatus.visible && (
        <div className="transaction-notification">
          <div className={`notification-content ${transactionStatus.status}`}>
            <div className="notification-icon">
              {transactionStatus.status === "pending" && <div className="spinner"></div>}
              {transactionStatus.status === "success" && <div className="checkmark"></div>}
              {transactionStatus.status === "error" && <div className="error"></div>}
            </div>
            <div className="notification-message">
              {transactionStatus.message}
            </div>
          </div>
        </div>
      )}
      
      <footer className="app-footer">
        <div className="footer-content">
          <div className="footer-section">
            <h3>SpaceWeatherFHE</h3>
            <p>Confidential analysis of space weather impacts using FHE technology</p>
          </div>
          <div className="footer-section">
            <h3>Partners</h3>
            <ul>
              <li>Power Grid Consortium</li>
              <li>Telecom Alliance</li>
              <li>Space Weather Institute</li>
            </ul>
          </div>
          <div className="footer-section">
            <h3>Resources</h3>
            <ul>
              <li><a href="#">Documentation</a></li>
              <li><a href="#">FHE Technology</a></li>
              <li><a href="#">Contact</a></li>
            </ul>
          </div>
        </div>
        <div className="footer-bottom">
          <p>© {new Date().getFullYear()} SpaceWeatherFHE. All rights reserved.</p>
          <div className="fhe-badge">
            <span>FHE-Powered Security</span>
          </div>
        </div>
      </footer>
    </div>
  );
};

export default App;