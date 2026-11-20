import { router } from 'expo-router';
import { Screen, ScreenHeader, useToast } from '@/components/design-system';
import { toListingPayload } from '@/domain/listings';
import { ListingWizard } from '@/features/listings/ListingWizard';
import { listingManagementRepository } from '@/repositories';

/** Create a listing as a draft; photos, availability and publishing follow on the overview. */
export default function NewListing() {
  const toast = useToast();
  return (
    <Screen>
      <ScreenHeader title="New listing" size="compact" back />
      <ListingWizard
        initial={{ title: '', category: '', condition: undefined as never, description: '', equipmentNotes: '', dailyRate: '', deposit: '0', lateFeePerDay: '0', pickupPointId: null, pickupNotes: '' }}
        submitLabel="Save draft"
        onSubmit={async (values) => {
          const r = await listingManagementRepository.create(toListingPayload(values));
          if (r.ok) {
            toast.show({ title: 'Draft saved', message: 'Add photos, then publish when you’re ready.', tone: 'success' });
            router.replace(`/manage/listings/${r.data}`);
          }
          return r;
        }}
      />
    </Screen>
  );
}
