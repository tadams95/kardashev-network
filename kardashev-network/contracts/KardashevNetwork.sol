// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

contract KardashevNetwork is ERC20, Ownable {
    // Event to track energy token creation and burning
    event EnergyTokenEvent(
        address indexed sender,
        uint256 amount,
        string eventType,
        uint256 totalSupply
    );

    // Mappings
    mapping(address => bool) public minters;
    mapping(address => uint256) public userMintTimestamps;
    mapping(address => uint256) public userMintedTokensToday;

    // Conversion rate between energy units and tokens
    uint256 public immutable conversionRate = 1;

    // Average daily energy production
    uint256 public immutable averageDailyProduction = 24; // kWh

    // Total supply
    uint256 public _totalSupply;

    // Constructor to initialize the token with a name, symbol, and initial supply
    constructor(
        address initialOwner
    ) ERC20("Energy Token", "ETK") Ownable(initialOwner) {
        // Mint initial supply to the contract deployer
        _mint(msg.sender, 10000000);
        _totalSupply = 10000000;
    }

    function getRemainingDailyTokens(
        address producer
    ) public view returns (uint256) {
        // Get timestamp of last mint for the producer
        uint256 lastMintTime = userMintTimestamps[producer];

        // Calculate time passed since last mint
        uint256 timePassed = block.timestamp - lastMintTime;

        // Check if daily limit reset
        if (timePassed >= 1 days) {
            return averageDailyProduction * conversionRate;
        }

        // Calculate remaining tokens based on time passed
        uint256 tokensMintedToday = userMintedTokensToday[producer];
        uint256 remainingTokens = averageDailyProduction *
            conversionRate -
            tokensMintedToday;

        return remainingTokens;
    }

    // Function to mint new energy tokens upon energy production
    function mintEnergyTokens(address producer) public {
        // Calculate tokens to mint
        uint256 tokensToMint = averageDailyProduction * conversionRate;

        // Update total supply
        uint256 newTotalSupply = _totalSupply + tokensToMint;
        _totalSupply = newTotalSupply;

        // Check daily token limit
        require(
            tokensToMint <= getRemainingDailyTokens(producer),
            "Daily token limit exceeded"
        );
        // Check authorized minter
        require(minters[msg.sender], "Unauthorized to mint tokens");

        // Validate producer
        require(producer != address(0), "Invalid producer");

        // Mint tokens to producer
        _mint(producer, tokensToMint);

        // Emit event
        emit EnergyTokenEvent(producer, tokensToMint, "Mint", _totalSupply);
    }

    // Function to burn energy tokens
    function burnEnergyTokens(uint256 amount) public {
        // Check sufficient balance
        require(balanceOf(msg.sender) >= amount, "Insufficient balance");

        // Burn tokens and update total supply
        _burn(msg.sender, amount);
        _totalSupply -= amount;

        // Emit event
        emit EnergyTokenEvent(msg.sender, amount, "Burn", _totalSupply);
    }

    // Function to set minter status for an address
    function setMinter(address account, bool status) public onlyOwner {
        minters[account] = status;
    }
}
