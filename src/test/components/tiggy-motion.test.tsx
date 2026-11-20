import { screen, userEvent, renderHook } from '@testing-library/react-native';
import { Tiggy } from '@/components/mascot/Tiggy';
import { MotionProvider, useMotion } from '@/lib/motion';
import { renderWithProviders } from '../render';

describe('Tiggy', () => {
  it('reveals a contextual tip on tap and can be dismissed', async () => {
    const user = userEvent.setup();
    await renderWithProviders(<Tiggy message="Your verification is waiting for review." />, { reducedMotion: true });
    expect(screen.queryByText('Your verification is waiting for review.')).not.toBeOnTheScreen();
    await user.press(screen.getByRole('button', { name: /Tiggy, the TigRent tiger/ }));
    expect(screen.getByText('Your verification is waiting for review.')).toBeOnTheScreen();
    await user.press(screen.getByRole('button', { name: "Dismiss Tiggy's tip" }));
    expect(screen.queryByText('Your verification is waiting for review.')).not.toBeOnTheScreen();
  });

  it('shows no speech bubble when there is nothing truthful to say', async () => {
    const user = userEvent.setup();
    await renderWithProviders(<Tiggy />, { reducedMotion: true });
    const img = screen.getByRole('image', { name: 'Tiggy, the TigRent tiger' });
    await user.press(img);
    expect(screen.queryByTestId('tiggy-bubble')).not.toBeOnTheScreen();
  });
});

describe('reduced motion', () => {
  it('disables ambient motion when reduced motion is on', async () => {
    const { result } = await renderHook(() => useMotion(), {
      wrapper: ({ children }) => <MotionProvider forceReduced>{children}</MotionProvider>,
    });
    expect(result.current.reduceMotion).toBe(true);
    expect(result.current.ambientMotion).toBe(false);
  });

  it('allows ambient motion by default', async () => {
    const { result } = await renderHook(() => useMotion(), {
      wrapper: ({ children }) => <MotionProvider forceReduced={false}>{children}</MotionProvider>,
    });
    expect(result.current.ambientMotion).toBe(true);
  });
});
