// app/(auth)/signup/page.tsx
'use client';

import React, { useState, useEffect } from 'react';
import { User, Mail, Lock, Eye, EyeOff, LogOut, User as UserIcon } from 'lucide-react';
import { auth } from '@/app/firebase/firebaseConfig';
import { onAuthStateChanged, User as FirebaseUser, signOut } from 'firebase/auth';
import { useRouter } from 'next/navigation';
import { signUp, signInWithGoogle, signInWithGithub } from '@/app/firebase/authService';
import OAuthButton from '@/components/OAuthButton';

export default function SignUp() {
  const [showPassword, setShowPassword] = useState(false);
  const [passwordStrength, setPasswordStrength] = useState(0);
  const [user, setUser] = useState<FirebaseUser | null>(null);
  const [formData, setFormData] = useState({
    name: '',
    email: '',
    password: ''
  });

  const router = useRouter();

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
      setUser(currentUser);
    });
    return () => unsubscribe();
  }, []);

  const checkPasswordStrength = (password: string) => {
    let strength = 0;
    if (password.length > 7) strength++;
    if (password.match(/[a-z]+/)) strength++;
    if (password.match(/[A-Z]+/)) strength++;
    if (password.match(/[0-9]+/)) strength++;
    if (password.match(/[$@#&!]+/)) strength++;
    return strength;
  };

  const handlePasswordChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const password = e.target.value;
    setFormData({ ...formData, password });
    setPasswordStrength(checkPasswordStrength(password));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const user = await signUp(formData.email, formData.password);
      if (user) {
        const token = await user.getIdToken();
        // Call the initialization API to create the sample playground and sheet
        await fetch("/api/users/initialize", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`
          }
        });
        alert('Account created successfully!');
        router.push('/playground');
      }
    } catch (error: any) {
      alert(error.message);
    }
  };

  const handleGoogleSignUp = async () => {
    try {
      const user = await signInWithGoogle();
      if (user) {
        const token = await user.getIdToken();
        // Call your initialization API
        await fetch("/api/users/initialize", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`
          }
        });
        alert('Account created successfully!');
        router.push('/playground');
      }
    } catch (error: any) {
      alert(error.message);
    }
  };

  const handleGithubSignUp = async () => {
    try {
      const user = await signInWithGithub();
      if (user) {
        const token = await user.getIdToken();
        // Call your initialization API
        await fetch("/api/users/initialize", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`
          }
        });
        alert('Account created successfully!');
        router.push('/playground');
      }
    } catch (error: any) {
      alert(error.message);
    }
  };

  const handleLogout = async () => {
    try {
      await signOut(auth);
      alert('Logged out successfully!');
    } catch (error: any) {
      alert(error.message);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-blue-800 via-purple-300 to-pink-400 text-white">
      <div className="bg-white border-2 border-gray-800 p-8 rounded-lg shadow-lg w-full max-w-md">
        <div className="text-center">
          <h2 className="text-3xl font-cinzel text-gray-800 mb-2">
            {user ? 'Welcome Back!' : 'Create Account'}
          </h2>
          <p className="text-gray-500 font-merriweather pb-4">
            {user ? `Signed in as ${user.email}` : 'Join AgentFlux today'}
          </p>
        </div>

        {user ? (
          <button
            onClick={handleLogout}
            className="w-full bg-red-500 text-white py-3 px-4 rounded-lg hover:opacity-90 focus:outline-none 
                      focus:ring-2 focus:ring-red-500 focus:ring-opacity-50 transition duration-300 
                      transform active:scale-95 shadow-lg flex justify-center items-center"
          >
            <LogOut className="w-5 h-5 mr-2" />
            Logout
          </button>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-6">
            <div className="relative">
              <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                <UserIcon className="text-gray-600 w-5 h-5" />
              </div>
              <input
                type="text"
                placeholder="Full Name"
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                required
                className="block text-black w-full px-12 py-3 border border-gray-300 rounded-lg shadow-sm 
                          focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent 
                          transition duration-300 placeholder-gray-400"
              />
            </div>
            <div className="relative">
              <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                <Mail className="text-gray-600 w-5 h-5" />
              </div>
              <input
                type="email"
                placeholder="Email Address"
                value={formData.email}
                onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                required
                className="block text-black w-full px-12 py-3 border border-gray-300 rounded-lg shadow-sm 
                          focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent 
                          transition duration-300 placeholder-gray-400"
              />
            </div>
            <div className="relative">
              <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                <Lock className="text-gray-600 w-5 h-5" />
              </div>
              <input
                type={showPassword ? 'text' : 'password'}
                placeholder="Password"
                value={formData.password}
                onChange={handlePasswordChange}
                required
                className="block text-black w-full px-12 py-3 border border-gray-300 rounded-lg shadow-sm 
                          focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent 
                          transition duration-300 placeholder-gray-400"
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute inset-y-0 right-0 pr-3 flex items-center text-gray-400 hover:text-purple-600"
              >
                {showPassword ? <Eye className="w-5 h-5" /> : <EyeOff className="w-5 h-5" />}
              </button>

            </div>
            {formData.password && (
              <div className="w-full bg-gray-200 rounded-full h-2.5">
                <div
                  className={`h-2.5 rounded-full transition-all duration-500 ${passwordStrength <= 2
                    ? 'bg-red-500 w-1/3'
                    : passwordStrength <= 3
                      ? 'bg-yellow-500 w-2/3'
                      : 'bg-green-500 w-full'
                    }`}
                ></div>
              </div>
            )}
            <div className="flex items-center">
              <input
                type="checkbox"
                id="terms"
                className="h-4 w-4 text-purple-600 focus:ring-purple-500 border-gray-300 rounded"
              />
              <label htmlFor="terms" className="ml-2 block text-sm text-gray-900">
                I agree to the Terms and Conditions
              </label>
            </div>
            <button
              type="submit"
              className="w-full bg-gradient-to-r from-blue-400 to-purple-400  text-white 
                      py-3 px-4 rounded-lg hover:opacity-90 focus:outline-none focus:ring-2 
                      focus:ring-purple-500 focus:ring-opacity-50 transition duration-300 
                      transform active:scale-95 shadow-lg"
            >
              Create Account
            </button>

            <div className="relative flex items-center justify-center my-4">
              <div className="border-t border-gray-300 flex-grow"></div>
              <span className="mx-4 text-sm text-gray-500 bg-white px-2 rounded">or</span>
              <div className="border-t border-gray-300 flex-grow"></div>
            </div>

            <div className="space-y-3">
              <OAuthButton
                provider="google"
                onClick={handleGoogleSignUp}
              />
              <OAuthButton
                provider="github"
                onClick={handleGithubSignUp}
              />
            </div>
          </form>
        )}

        {!user && (
          <div className="text-center mt-4">
            <p className="text-sm text-gray-600">
              Already have an account?
              <a href="/signin" className="text-purple-600 hover:text-purple-500 ml-1">
                Sign In
              </a>
            </p>
          </div>
        )}
      </div>
    </div>
  );
}