import { useState, useEffect, useMemo, useRef } from "react";
import {
  Save,
  Key,
  Shield,
  Activity,
  Settings,
  User as UserIcon,
  Building,
  Hash,
  Upload,
  ImagePlus,
} from "lucide-react";
import { issuerProfileApi } from "../api";
import {
  useIssuerActivityQuery,
  useIssuerStatsQuery,
  useUpdateIssuerProfileMutation,
  useUserProfileQuery,
} from "../api/queries";

const MAX_PROFILE_PICTURE_SIZE = 5 * 1024 * 1024;
const ALLOWED_PROFILE_PICTURE_TYPES = [
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
];

const IssuerProfile = () => {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [statsError, setStatsError] = useState<string | null>(null);
  const [activityError, setActivityError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [profilePreview, setProfilePreview] = useState("");
  const [selectedProfileImage, setSelectedProfileImage] = useState<File | null>(
    null,
  );
  const [localPreviewUrl, setLocalPreviewUrl] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // Form state
  const [formData, setFormData] = useState({
    firstName: "",
    lastName: "",
    email: "",
    username: "",
    phone: "",
    organization: "",
    stellarPublicKey: "",
    profilePicture: "",
  });

  // Three independent queries: the profile, the issuer statistics and the
  // activity log now load in parallel instead of as a serial waterfall.
  const profileQuery = useUserProfileQuery();
  const statsQuery = useIssuerStatsQuery();
  const activityQuery = useIssuerActivityQuery();
  const updateProfileMutation = useUpdateIssuerProfileMutation();

  const loading = profileQuery.isPending;
  const profile = profileQuery.data;

  const stats = {
    totalCertificates: statsQuery.data?.totalCertificates ?? 0,
    activeCertificates: statsQuery.data?.activeCertificates ?? 0,
    revokedCertificates: statsQuery.data?.revokedCertificates ?? 0,
    expiredCertificates: statsQuery.data?.expiredCertificates ?? 0,
    totalVerifications: statsQuery.data?.totalVerifications ?? 0,
    lastLogin: statsQuery.data?.lastLogin ?? "",
  };

  const activities = useMemo(
    () =>
      (activityQuery.data?.activities ?? []).map(
        (activity: {
          id: string;
          action: string;
          description: string;
          timestamp: string;
          ipAddress?: string;
        }) => ({
          id: activity.id,
          action: activity.action,
          description: activity.description,
          timestamp: activity.timestamp,
          ip: activity.ipAddress || "Unknown IP",
        }),
      ),
    [activityQuery.data],
  );

  // Seed the form from the cached profile the first time it arrives. Seeding is
  // one-shot per mount so a background revalidation can't discard edits the user
  // has typed since; a successful save updates the form explicitly instead.
  const seededFromProfile = useRef(false);
  useEffect(() => {
    if (!profile || seededFromProfile.current) return;
    seededFromProfile.current = true;

    setFormData({
      firstName: profile.firstName,
      lastName: profile.lastName,
      email: profile.email,
      username: profile.username || "",
      phone: profile.phone || "",
      organization: profile.metadata?.organization
        ? String(profile.metadata.organization)
        : "",
      stellarPublicKey: profile.stellarPublicKey || "",
      profilePicture: profile.profilePicture || "",
    });
    setSelectedProfileImage(null);
    setProfilePreview(profile.profilePicture || "");
  }, [profile]);

  useEffect(() => {
    if (profileQuery.isError) {
      setError("Failed to load profile");
    }
  }, [profileQuery.isError]);

  // The statistics and the activity log are separate queries, so a failure in
  // either is reported in its own panel instead of taking the whole page down.
  useEffect(() => {
    if (statsQuery.isError) {
      setStatsError("Failed to load issuer statistics");
      console.error("Failed to load issuer stats", statsQuery.error);
    } else {
      setStatsError(null);
    }
  }, [statsQuery.isError, statsQuery.error]);

  useEffect(() => {
    if (activityQuery.isError) {
      setActivityError("Failed to load recent activity");
      console.error("Failed to load issuer activity", activityQuery.error);
    } else {
      setActivityError(null);
    }
  }, [activityQuery.isError, activityQuery.error]);

  useEffect(() => {
    return () => {
      if (localPreviewUrl) {
        URL.revokeObjectURL(localPreviewUrl);
      }
    };
  }, [localPreviewUrl]);

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    setFormData((prev) => ({
      ...prev,
      [name]: value,
    }));
  };

  const validateStellarKey = (key: string) => {
    if (!key) return true;
    const regex = /^G[A-Z2-7]{55}$/;
    return regex.test(key);
  };

  const handleProfilePictureChange = (
    e: React.ChangeEvent<HTMLInputElement>,
  ) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!ALLOWED_PROFILE_PICTURE_TYPES.includes(file.type)) {
      setError("Please select a JPG, PNG, GIF, or WebP image");
      return;
    }

    if (file.size > MAX_PROFILE_PICTURE_SIZE) {
      setError("Profile picture must be 5MB or smaller");
      return;
    }

    if (localPreviewUrl) {
      URL.revokeObjectURL(localPreviewUrl);
    }

    const previewUrl = URL.createObjectURL(file);
    setSelectedProfileImage(file);
    setLocalPreviewUrl(previewUrl);
    setProfilePreview(previewUrl);
    setError(null);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (
      formData.stellarPublicKey &&
      !validateStellarKey(formData.stellarPublicKey)
    ) {
      setError("Invalid Stellar public key format");
      return;
    }

    try {
      setSaving(true);
      setError(null);
      setSuccess(null);
      let uploadedProfilePicture = formData.profilePicture;

      if (selectedProfileImage) {
        const uploadResult =
          await issuerProfileApi.uploadProfilePicture(selectedProfileImage);
        uploadedProfilePicture = uploadResult.profilePicture;
      }

      const updatedUser = await updateProfileMutation.mutateAsync({
        firstName: formData.firstName,
        lastName: formData.lastName,
        username: formData.username || undefined,
        phone: formData.phone || undefined,
        organization: formData.organization || undefined,
        stellarPublicKey: formData.stellarPublicKey || undefined,
        profilePicture: uploadedProfilePicture || undefined,
      });

      setFormData({
        firstName: updatedUser.firstName,
        lastName: updatedUser.lastName,
        email: updatedUser.email,
        username: updatedUser.username || "",
        phone: updatedUser.phone || "",
        organization: updatedUser.metadata?.organization
          ? String(updatedUser.metadata.organization)
          : formData.organization,
        stellarPublicKey: updatedUser.stellarPublicKey || "",
        profilePicture:
          uploadedProfilePicture || updatedUser.profilePicture || "",
      });
      if (localPreviewUrl) {
        URL.revokeObjectURL(localPreviewUrl);
        setLocalPreviewUrl(null);
      }
      setProfilePreview(
        uploadedProfilePicture || updatedUser.profilePicture || "",
      );
      setSelectedProfileImage(null);
      setSuccess("Profile updated successfully");
    } catch (err) {
      setError("Failed to update profile");
      console.error(err);
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="max-w-7xl mx-auto py-8">
        <div className="flex items-center justify-center h-64">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto py-8">
      <div className="mb-6">
        <h1 className="text-3xl font-bold text-gray-900 dark:text-slate-100">
          Issuer Profile Management
        </h1>
        <p className="mt-2 text-gray-600 dark:text-slate-400">
          Manage your profile information, Stellar integration, and view
          activity logs
        </p>
      </div>

      {error && (
        <div className="mb-6 bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg dark:bg-red-900/20 dark:border-red-700 dark:text-red-300">
          {error}
        </div>
      )}

      {success && (
        <div className="mb-6 bg-green-50 border border-green-200 text-green-700 px-4 py-3 rounded-lg dark:bg-green-900/20 dark:border-green-700 dark:text-green-300">
          {success}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Profile Information Form */}
        <div className="lg:col-span-2">
          <div className="bg-white shadow rounded-lg dark:bg-slate-900 dark:border dark:border-slate-700">
            <div className="px-6 py-4 border-b border-gray-200 dark:border-slate-700">
              <h2 className="text-lg font-semibold text-gray-900 dark:text-slate-100 flex items-center">
                <UserIcon className="h-5 w-5 mr-2 text-blue-600" />
                Profile Information
              </h2>
            </div>
            <form onSubmit={handleSubmit} className="p-6">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-slate-300 mb-2">
                    First Name
                  </label>
                  <input
                    type="text"
                    name="firstName"
                    value={formData.firstName}
                    onChange={handleInputChange}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 dark:bg-slate-800 dark:border-slate-600 dark:text-white"
                    required
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-slate-300 mb-2">
                    Last Name
                  </label>
                  <input
                    type="text"
                    name="lastName"
                    value={formData.lastName}
                    onChange={handleInputChange}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 dark:bg-slate-800 dark:border-slate-600 dark:text-white"
                    required
                  />
                </div>
                <div className="md:col-span-2">
                  <label className="block text-sm font-medium text-gray-700 dark:text-slate-300 mb-2">
                    Email Address
                  </label>
                  <input
                    type="email"
                    name="email"
                    value={formData.email}
                    onChange={handleInputChange}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 bg-gray-50 dark:bg-slate-800 dark:border-slate-600 dark:text-slate-300"
                    disabled
                  />
                  <p className="mt-1 text-sm text-gray-500 dark:text-slate-400">
                    Email cannot be changed
                  </p>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-slate-300 mb-2">
                    Username
                  </label>
                  <input
                    type="text"
                    name="username"
                    value={formData.username}
                    onChange={handleInputChange}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 dark:bg-slate-800 dark:border-slate-600 dark:text-white"
                    placeholder="johndoe"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-slate-300 mb-2">
                    Phone Number
                  </label>
                  <input
                    type="tel"
                    name="phone"
                    value={formData.phone}
                    onChange={handleInputChange}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 dark:bg-slate-800 dark:border-slate-600 dark:text-white"
                    placeholder="+1234567890"
                  />
                </div>
                <div className="md:col-span-2">
                  <label className="block text-sm font-medium text-gray-700 dark:text-slate-300 mb-2">
                    Organization
                  </label>
                  <input
                    type="text"
                    name="organization"
                    value={formData.organization}
                    onChange={handleInputChange}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 dark:bg-slate-800 dark:border-slate-600 dark:text-white"
                    placeholder="Your organization name"
                  />
                </div>
                <div className="md:col-span-2">
                  <label className="block text-sm font-medium text-gray-700 dark:text-slate-300 mb-2">
                    Profile Picture
                  </label>
                  <div className="flex flex-col gap-4 rounded-lg border border-dashed border-gray-300 bg-gray-50 p-4 sm:flex-row sm:items-center dark:border-slate-600 dark:bg-slate-800">
                    <div className="flex h-24 w-24 items-center justify-center overflow-hidden rounded-full border border-gray-200 bg-white dark:border-slate-600 dark:bg-slate-900">
                      {profilePreview ? (
                        <img
                          src={profilePreview}
                          alt="Profile preview"
                          className="h-full w-full object-cover"
                        />
                      ) : (
                        <ImagePlus className="h-8 w-8 text-gray-400 dark:text-slate-500" />
                      )}
                    </div>
                    <div className="flex-1">
                      <input
                        ref={fileInputRef}
                        type="file"
                        accept={ALLOWED_PROFILE_PICTURE_TYPES.join(",")}
                        className="hidden"
                        onChange={handleProfilePictureChange}
                      />
                      <button
                        type="button"
                        onClick={() => fileInputRef.current?.click()}
                        className="inline-flex items-center rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
                      >
                        <Upload className="mr-2 h-4 w-4" />
                        {selectedProfileImage ? "Change Image" : "Select Image"}
                      </button>
                      <p className="mt-2 text-sm text-gray-600 dark:text-slate-400">
                        JPG, PNG, GIF, or WebP. Maximum size 5MB.
                      </p>
                      {selectedProfileImage && (
                        <p className="mt-1 text-sm text-gray-500 dark:text-slate-400">
                          Ready to upload: {selectedProfileImage.name}
                        </p>
                      )}
                      {!selectedProfileImage && formData.profilePicture && (
                        <p className="mt-1 text-sm text-gray-500 dark:text-slate-400">
                          Current picture will stay unless you select a new
                          file.
                        </p>
                      )}
                    </div>
                  </div>
                </div>
              </div>

              <div className="mt-8 pt-6 border-t border-gray-200 dark:border-slate-700">
                <button
                  type="submit"
                  disabled={saving}
                  className="flex items-center px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50"
                >
                  <Save className="h-4 w-4 mr-2" />
                  {saving ? "Saving..." : "Save Changes"}
                </button>
              </div>
            </form>
          </div>
        </div>

        {/* Sidebar with Stellar Integration and Stats */}
        <div className="space-y-6">
          {/* Stellar Integration Card */}
          <div className="bg-white shadow rounded-lg dark:bg-slate-900 dark:border dark:border-slate-700">
            <div className="px-6 py-4 border-b border-gray-200 dark:border-slate-700">
              <h2 className="text-lg font-semibold text-gray-900 dark:text-slate-100 flex items-center">
                <Key className="h-5 w-5 mr-2 text-purple-600" />
                Stellar Integration
              </h2>
            </div>
            <div className="p-6">
              <div className="mb-4">
                <label className="block text-sm font-medium text-gray-700 dark:text-slate-300 mb-2">
                  Stellar Public Key
                </label>
                <div className="flex">
                  <input
                    type="text"
                    name="stellarPublicKey"
                    value={formData.stellarPublicKey}
                    onChange={handleInputChange}
                    className={`flex-1 px-3 py-2 border ${
                      formData.stellarPublicKey &&
                      !validateStellarKey(formData.stellarPublicKey)
                        ? "border-red-300 dark:border-red-500"
                        : "border-gray-300 dark:border-slate-600"
                    } rounded-l-md focus:outline-none focus:ring-2 focus:ring-blue-500 dark:bg-slate-800 dark:text-white`}
                    placeholder="GXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX"
                  />
                  <button
                    type="button"
                    className="px-3 py-2 bg-gray-100 border border-l-0 border-gray-300 rounded-r-md text-gray-600 hover:bg-gray-200 dark:bg-slate-800 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-700"
                    onClick={() => {
                      // Generate new key pair logic would go here
                      alert("Key generation feature coming soon");
                    }}
                  >
                    <Shield className="h-4 w-4" />
                  </button>
                </div>
                {formData.stellarPublicKey &&
                  !validateStellarKey(formData.stellarPublicKey) && (
                    <p className="mt-1 text-sm text-red-600">
                      Invalid Stellar public key format
                    </p>
                  )}
              </div>

              <div className="bg-blue-50 border border-blue-200 rounded-md p-4 dark:bg-blue-900/20 dark:border-blue-700">
                <div className="flex items-start">
                  <Shield className="h-5 w-5 text-blue-600 mt-0.5 mr-2 flex-shrink-0" />
                  <div>
                    <h3 className="text-sm font-medium text-blue-800 dark:text-blue-200">
                      Security Note
                    </h3>
                    <p className="mt-1 text-sm text-blue-700 dark:text-blue-300">
                      Your Stellar public key is used for blockchain operations.
                      Never share your secret key.
                    </p>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Statistics Card */}
          <div className="bg-white shadow rounded-lg dark:bg-slate-900 dark:border dark:border-slate-700">
            <div className="px-6 py-4 border-b border-gray-200 dark:border-slate-700">
              <h2 className="text-lg font-semibold text-gray-900 dark:text-slate-100 flex items-center">
                <Settings className="h-5 w-5 mr-2 text-green-600" />
                Issuer Statistics
              </h2>
            </div>
            <div className="p-6">
              {statsError && (
                <p
                  role="alert"
                  className="mb-4 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-900/20 dark:text-red-300"
                >
                  {statsError}
                </p>
              )}
              <div className="space-y-4">
                <div className="flex justify-between items-center">
                  <span className="text-gray-600 dark:text-slate-400">
                    Total Certificates
                  </span>
                  <span className="font-semibold text-blue-600">
                    {stats.totalCertificates}
                  </span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-gray-600 dark:text-slate-400">
                    Active Certificates
                  </span>
                  <span className="font-semibold text-green-600">
                    {stats.activeCertificates}
                  </span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-gray-600 dark:text-slate-400">
                    Revoked Certificates
                  </span>
                  <span className="font-semibold text-red-600">
                    {stats.revokedCertificates}
                  </span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-gray-600 dark:text-slate-400">
                    Total Verifications
                  </span>
                  <span className="font-semibold text-purple-600">
                    {stats.totalVerifications}
                  </span>
                </div>
                <div className="flex justify-between items-center pt-4 border-t border-gray-200 dark:border-slate-700">
                  <span className="text-gray-600 dark:text-slate-400">
                    Last Login
                  </span>
                  <span className="text-sm text-gray-500 dark:text-slate-500">
                    {new Date(stats.lastLogin).toLocaleDateString()}
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Activity Log Section */}
      <div className="mt-8 bg-white shadow rounded-lg dark:bg-slate-900 dark:border dark:border-slate-700">
        <div className="px-6 py-4 border-b border-gray-200 dark:border-slate-700">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-slate-100 flex items-center">
            <Activity className="h-5 w-5 mr-2 text-orange-600" />
            Recent Activity
          </h2>
        </div>
        <div className="p-6">
          {activities.length === 0 ? (
            <div className="text-center py-8 text-gray-500 dark:text-slate-400">
              <Activity className="h-12 w-12 mx-auto text-gray-300 dark:text-slate-600 mb-4" />
              {activityError ? (
                <p role="alert" className="text-red-600 dark:text-red-400">
                  {activityError}
                </p>
              ) : (
                <p>No recent activity found</p>
              )}
            </div>
          ) : (
            <div className="space-y-4">
              {activities.map((activity) => (
                <div
                  key={activity.id}
                  className="flex items-start p-4 border border-gray-200 rounded-lg dark:border-slate-700 dark:bg-slate-800/40"
                >
                  <div className="flex-shrink-0">
                    <div className="h-10 w-10 rounded-full bg-blue-100 dark:bg-blue-900/40 flex items-center justify-center">
                      <Activity className="h-5 w-5 text-blue-600" />
                    </div>
                  </div>
                  <div className="ml-4 flex-1">
                    <div className="flex items-center justify-between">
                      <h3 className="text-sm font-medium text-gray-900 dark:text-slate-100">
                        {activity.description}
                      </h3>
                      <span className="text-xs text-gray-500 dark:text-slate-500">
                        {new Date(activity.timestamp).toLocaleString()}
                      </span>
                    </div>
                    <div className="mt-1 flex items-center text-xs text-gray-500 dark:text-slate-400">
                      <Hash className="h-3 w-3 mr-1" />
                      {activity.action} •
                      <Building className="h-3 w-3 ml-2 mr-1" />
                      IP: {activity.ip}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default IssuerProfile;
