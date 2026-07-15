import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import App from './App';
import React from 'react';
import * as stellar from './utils/stellar';

// Mock the stellar utilities
vi.mock('./utils/stellar', () => {
  return {
    isConnected: vi.fn(),
    getPublicKey: vi.fn(),
    getCampaignsRegistry: vi.fn(),
    getCampaignDetails: vi.fn(),
    createCampaign: vi.fn(),
    pledge: vi.fn(),
    withdraw: vi.fn(),
    claimRefund: vi.fn(),
    getCampaignEvents: vi.fn(),
  };
});

describe('StellarFund Frontend Dashboard Tests', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    
    // Set default mock implementations
    vi.mocked(stellar.isConnected).mockResolvedValue(false);
    vi.mocked(stellar.getPublicKey).mockResolvedValue(null);
    vi.mocked(stellar.getCampaignsRegistry).mockResolvedValue(['CANJBNLY4BAJ5CMBQ6N7YVDJQBPTNLRA2JD574KEFEQ64EJI3VEECQAF']);
    vi.mocked(stellar.getCampaignDetails).mockResolvedValue({
      id: 'CANJBNLY4BAJ5CMBQ6N7YVDJQBPTNLRA2JD574KEFEQ64EJI3VEECQAF',
      creator: 'GCYMLCJTY6KNGGWRXHNMPDVQIPJZDQKHU45W4TA3QUELIPCFKY3ARHF5',
      token: 'CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC',
      goal: 100,
      deadline: Math.floor(Date.now() / 1000) + 86400 * 5, // 5 days in the future
      title: 'Save the Oceans',
      description: 'Clean plastic from water',
      totalPledged: 10,
      status: 'Active',
      userPledge: 0,
    });
    vi.mocked(stellar.getCampaignEvents).mockResolvedValue([]);
  });

  // Test Case 1: renders campaign list correctly
  it('renders the campaigns list correctly', async () => {
    render(<App />);
    
    // Check if the mock campaign title is rendered on the dashboard
    await waitFor(() => {
      const titleElement = screen.getByText('Save the Oceans');
      expect(titleElement).not.toBeNull();
    });

    const descElement = screen.getByText('Clean plastic from water');
    expect(descElement).not.toBeNull();
  });

  // Test Case 2: pledge button disabled when wallet is not connected
  it('shows wallet disclaimer and pledge details when viewing campaign details', async () => {
    render(<App />);

    // Click "View Details & Pledge" button
    await waitFor(async () => {
      const viewDetailsBtn = screen.getByText('View Details & Pledge');
      fireEvent.click(viewDetailsBtn);
    });

    // Check if the campaign address title or story is shown
    await waitFor(() => {
      expect(screen.getByText('Campaign Story')).not.toBeNull();
    });

    // Assert disclaimer text is shown
    const disclaimer = screen.getByText(/Please connect your Freighter wallet to pledge/);
    expect(disclaimer).not.toBeNull();

    // Check that the Pledge button is disabled
    const pledgeBtn = screen.getByRole('button', { name: 'Pledge Funds' });
    expect(pledgeBtn.getAttribute('disabled')).not.toBeNull();
  });

  // Test Case 3: form validation (goal must be > 0)
  it('shows validation errors if creating a campaign with invalid inputs', async () => {
    // Mock wallet to be connected so create campaign form is submission-ready
    vi.mocked(stellar.isConnected).mockResolvedValue(true);
    vi.mocked(stellar.getPublicKey).mockResolvedValue('GCYMLCJTY6KNGGWRXHNMPDVQIPJZDQKHU45W4TA3QUELIPCFKY3ARHF5');

    const { container } = render(<App />);

    // Click "Start a Campaign" button to open creation drawer
    const startBtn = screen.getByText('Start a Campaign');
    fireEvent.click(startBtn);

    // Wait for the creation form fields to render in the DOM
    await waitFor(() => {
      expect(screen.getByPlaceholderText('e.g. Tree Planting Drive')).not.toBeNull();
    });

    // Get input fields
    const titleInput = screen.getByPlaceholderText('e.g. Tree Planting Drive');
    const goalInput = screen.getByPlaceholderText('e.g. 5000');
    const deadlineInput = container.querySelector('input[type="datetime-local"]');

    expect(deadlineInput).not.toBeNull();
    
    // Fill title
    fireEvent.change(titleInput, { target: { value: 'New Test Campaign' } });
    
    // Fill invalid goal (0)
    fireEvent.change(goalInput, { target: { value: '0' } });

    // Set a valid future deadline date
    fireEvent.change(deadlineInput!, { target: { value: '2026-12-31T23:59' } });

    // Submit form
    const submitBtn = screen.getByText('Deploy Campaign Contract');
    fireEvent.click(submitBtn);

    // Wait and assert that validation error message is shown
    await waitFor(() => {
      const errorMsg = screen.getByText('Goal must be a positive number greater than 0.');
      expect(errorMsg).not.toBeNull();
    });
  });
});
