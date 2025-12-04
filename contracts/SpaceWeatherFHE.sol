// SpaceWeatherFHE.sol
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { FHE, euint32, ebool } from "@fhevm/solidity/lib/FHE.sol";
import { SepoliaConfig } from "@fhevm/solidity/config/ZamaConfig.sol";

contract SpaceWeatherFHE is SepoliaConfig {
    struct EncryptedInfrastructureData {
        uint256 id;
        euint32 encryptedEquipmentStatus;
        euint32 encryptedOutageData;
        euint32 encryptedGeomagneticData;
        uint256 timestamp;
    }
    
    struct ImpactAnalysis {
        euint32 encryptedVulnerabilityScore;
        euint32 encryptedRiskAssessment;
        euint32 encryptedMitigationScore;
    }

    struct DecryptedInfrastructureData {
        string equipmentStatus;
        string outageData;
        string geomagneticData;
        bool isRevealed;
    }

    uint256 public dataCount;
    mapping(uint256 => EncryptedInfrastructureData) public encryptedInfrastructureData;
    mapping(uint256 => DecryptedInfrastructureData) public decryptedInfrastructureData;
    mapping(uint256 => ImpactAnalysis) public impactAnalyses;
    
    mapping(uint256 => uint256) private requestToDataId;
    
    event DataSubmitted(uint256 indexed id, uint256 timestamp);
    event AnalysisRequested(uint256 indexed dataId);
    event AnalysisCompleted(uint256 indexed dataId);
    event DecryptionRequested(uint256 indexed dataId);
    event DataDecrypted(uint256 indexed dataId);
    
    modifier onlyOperator(uint256 dataId) {
        _;
    }
    
    function submitEncryptedData(
        euint32 encryptedEquipmentStatus,
        euint32 encryptedOutageData,
        euint32 encryptedGeomagneticData
    ) public {
        dataCount += 1;
        uint256 newId = dataCount;
        
        encryptedInfrastructureData[newId] = EncryptedInfrastructureData({
            id: newId,
            encryptedEquipmentStatus: encryptedEquipmentStatus,
            encryptedOutageData: encryptedOutageData,
            encryptedGeomagneticData: encryptedGeomagneticData,
            timestamp: block.timestamp
        });
        
        decryptedInfrastructureData[newId] = DecryptedInfrastructureData({
            equipmentStatus: "",
            outageData: "",
            geomagneticData: "",
            isRevealed: false
        });
        
        emit DataSubmitted(newId, block.timestamp);
    }
    
    function requestDataDecryption(uint256 dataId) public onlyOperator(dataId) {
        EncryptedInfrastructureData storage data = encryptedInfrastructureData[dataId];
        require(!decryptedInfrastructureData[dataId].isRevealed, "Already decrypted");
        
        bytes32[] memory ciphertexts = new bytes32[](3);
        ciphertexts[0] = FHE.toBytes32(data.encryptedEquipmentStatus);
        ciphertexts[1] = FHE.toBytes32(data.encryptedOutageData);
        ciphertexts[2] = FHE.toBytes32(data.encryptedGeomagneticData);
        
        uint256 reqId = FHE.requestDecryption(ciphertexts, this.decryptInfrastructureData.selector);
        requestToDataId[reqId] = dataId;
        
        emit DecryptionRequested(dataId);
    }
    
    function decryptInfrastructureData(
        uint256 requestId,
        bytes memory cleartexts,
        bytes memory proof
    ) public {
        uint256 dataId = requestToDataId[requestId];
        require(dataId != 0, "Invalid request");
        
        EncryptedInfrastructureData storage eData = encryptedInfrastructureData[dataId];
        DecryptedInfrastructureData storage dData = decryptedInfrastructureData[dataId];
        require(!dData.isRevealed, "Already decrypted");
        
        FHE.checkSignatures(requestId, cleartexts, proof);
        
        string[] memory results = abi.decode(cleartexts, (string[]));
        
        dData.equipmentStatus = results[0];
        dData.outageData = results[1];
        dData.geomagneticData = results[2];
        dData.isRevealed = true;
        
        emit DataDecrypted(dataId);
    }
    
    function requestImpactAnalysis(uint256 dataId) public onlyOperator(dataId) {
        require(encryptedInfrastructureData[dataId].id != 0, "Data not found");
        
        emit AnalysisRequested(dataId);
    }
    
    function submitAnalysisResults(
        uint256 dataId,
        euint32 encryptedVulnerabilityScore,
        euint32 encryptedRiskAssessment,
        euint32 encryptedMitigationScore
    ) public {
        impactAnalyses[dataId] = ImpactAnalysis({
            encryptedVulnerabilityScore: encryptedVulnerabilityScore,
            encryptedRiskAssessment: encryptedRiskAssessment,
            encryptedMitigationScore: encryptedMitigationScore
        });
        
        emit AnalysisCompleted(dataId);
    }
    
    function requestResultDecryption(uint256 dataId, uint8 resultType) public onlyOperator(dataId) {
        ImpactAnalysis storage analysis = impactAnalyses[dataId];
        require(FHE.isInitialized(analysis.encryptedVulnerabilityScore), "No analysis available");
        
        bytes32[] memory ciphertexts = new bytes32[](1);
        
        if (resultType == 0) {
            ciphertexts[0] = FHE.toBytes32(analysis.encryptedVulnerabilityScore);
        } else if (resultType == 1) {
            ciphertexts[0] = FHE.toBytes32(analysis.encryptedRiskAssessment);
        } else if (resultType == 2) {
            ciphertexts[0] = FHE.toBytes32(analysis.encryptedMitigationScore);
        } else {
            revert("Invalid result type");
        }
        
        uint256 reqId = FHE.requestDecryption(ciphertexts, this.decryptAnalysisResult.selector);
        requestToDataId[reqId] = dataId * 10 + resultType;
    }
    
    function decryptAnalysisResult(
        uint256 requestId,
        bytes memory cleartexts,
        bytes memory proof
    ) public {
        uint256 compositeId = requestToDataId[requestId];
        uint256 dataId = compositeId / 10;
        uint8 resultType = uint8(compositeId % 10);
        
        FHE.checkSignatures(requestId, cleartexts, proof);
        
        string memory result = abi.decode(cleartexts, (string));
    }
    
    function getDecryptedData(uint256 dataId) public view returns (
        string memory equipmentStatus,
        string memory outageData,
        string memory geomagneticData,
        bool isRevealed
    ) {
        DecryptedInfrastructureData storage d = decryptedInfrastructureData[dataId];
        return (d.equipmentStatus, d.outageData, d.geomagneticData, d.isRevealed);
    }
    
    function hasImpactAnalysis(uint256 dataId) public view returns (bool) {
        return FHE.isInitialized(impactAnalyses[dataId].encryptedVulnerabilityScore);
    }
}